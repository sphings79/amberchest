import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ArchiveDatabase } from '../src/db/database.js';
import { sealMessageFile } from '../src/storage/encryption.js';
import type { Account, RemoteFolder } from '../src/types.js';
import { VerifyEngine } from '../src/verify/engine.js';

const MESSAGE = 'From: a@example.com\r\nSubject: Test\r\n\r\nHallo Welt\r\n';

function account(base: string): Account {
  return {
    id: 'acc-1',
    name: 'Test',
    email: 'test@example.com',
    host: 'imap.example.com',
    port: 993,
    security: 'tls',
    rejectUnauthorized: true,
    username: 'test@example.com',
    password: '',
    authType: 'password',
    oauth: null,
    archivePath: join(base, 'archive'),
    selectedFolders: ['INBOX'],
    settings: {
      concurrency: 2,
      batchSize: 200,
      requestDelayMs: 0,
      sinceDate: null,
      deletedHandling: 'move-to-deleted',
      deletedRetentionDays: null,
      autoSelectNewFolders: false,
    },
    attachments: {
      targetPath: null,
      layout: 'folder-tree',
      includeInline: false,
      minSizeBytes: 0,
      extensionMode: 'all',
      extensions: [],
      deduplicate: true,
      writeManifest: true,
      folders: [],
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

/** An archive with three messages, on disk and in the index. */
function seed(options: { withHash?: boolean; key?: Buffer | null } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'ma-verify-'));
  const db = new ArchiveDatabase(join(base, 'archive.db'));
  const acc = account(base);

  const folder: RemoteFolder = {
    path: 'INBOX',
    name: 'INBOX',
    delimiter: '/',
    specialUse: '\\Inbox',
    noSelect: false,
    messageCount: null,
    sizeBytes: null,
  };
  const row = db.upsertFolder(acc.id, folder, 'INBOX');
  const folderDir = join(acc.archivePath as string, 'INBOX');
  mkdirSync(folderDir, { recursive: true });

  const files: string[] = [];
  for (let index = 1; index <= 3; index += 1) {
    const source = Buffer.from(`${MESSAGE}Nummer ${index}\r\n`, 'utf8');
    const fileName = `2024-01-0${index}_100000_${index}_Test.eml`;
    writeFileSync(
      join(folderDir, fileName),
      options.key ? sealMessageFile(source, options.key) : source,
    );
    db.insertMessage({
      accountId: acc.id,
      folderId: row.id,
      uid: index,
      uidvalidity: 1,
      messageId: `<${index}@x>`,
      fingerprint: `fp-${index}`,
      internalDate: `2024-01-0${index}T10:00:00.000Z`,
      size: source.length,
      subject: 'Test',
      fromAddr: 'a@example.com',
      toAddr: 'me@example.com',
      flags: [],
      fileName,
      sha256: options.withHash ? createHash('sha256').update(source).digest('hex') : null,
    });
    files.push(join(folderDir, fileName));
  }

  return { base, db, account: acc, folderDir, files };
}

describe('VerifyEngine', () => {
  it('is happy with an archive that is intact', async () => {
    const { db, account: acc, base } = seed({ withHash: true });
    const result = await new VerifyEngine(acc, {
      db,
      archiveBaseDir: join(base, 'archive'),
    }).run();

    expect(result.phase).toBe('done');
    expect(result.stats.messagesChecked).toBe(3);
    expect(result.stats.missing).toBe(0);
    expect(result.stats.changed).toBe(0);
    expect(result.stats.orphans).toBe(0);
    expect(result.findings).toHaveLength(0);
  });

  it('finds a file that is gone', async () => {
    const { db, account: acc, base, files } = seed({ withHash: true });
    rmSync(files[1] as string);

    const result = await new VerifyEngine(acc, { db, archiveBaseDir: join(base, 'archive') }).run();
    expect(result.stats.missing).toBe(1);
    expect(result.findings[0]).toMatchObject({ kind: 'missing', folder: 'INBOX' });
  });

  it('finds a file that changed behind our back', async () => {
    const { db, account: acc, base, files } = seed({ withHash: true });
    writeFileSync(files[0] as string, 'something else entirely');

    const result = await new VerifyEngine(acc, { db, archiveBaseDir: join(base, 'archive') }).run();
    expect(result.stats.changed).toBe(1);
    expect(result.findings[0]?.kind).toBe('changed');
    expect(result.findings[0]?.detail).toBe('hashMismatch');
    expect(result.findings[0]?.detailParams).toMatchObject({ expected: expect.any(String) });
  });

  it('finds a file the index knows nothing about', async () => {
    const { db, account: acc, base, folderDir } = seed({ withHash: true });
    writeFileSync(join(folderDir, 'stray.eml'), MESSAGE);

    const result = await new VerifyEngine(acc, { db, archiveBaseDir: join(base, 'archive') }).run();
    expect(result.stats.orphans).toBe(1);
    expect(result.findings[0]).toMatchObject({ kind: 'orphan' });
  });

  it('fills in checksums that an older version never wrote', async () => {
    const { db, account: acc, base } = seed({ withHash: false });

    const first = await new VerifyEngine(acc, { db, archiveBaseDir: join(base, 'archive') }).run();
    expect(first.stats.hashesAdded).toBe(3);
    expect(first.stats.changed).toBe(0);

    // Once they are stored, the next run compares against them.
    const second = await new VerifyEngine(acc, { db, archiveBaseDir: join(base, 'archive') }).run();
    expect(second.stats.hashesAdded).toBe(0);
    expect(second.stats.changed).toBe(0);
  });

  it('reads an encrypted archive, and complains with the wrong key', async () => {
    const key = Buffer.alloc(32, 7);
    const { db, account: acc, base } = seed({ withHash: true, key });

    const good = await new VerifyEngine(acc, {
      db,
      archiveBaseDir: join(base, 'archive'),
      encryptionKey: key,
    }).run();
    expect(good.stats.changed).toBe(0);
    expect(good.stats.unreadable).toBe(0);

    const bad = await new VerifyEngine(acc, {
      db,
      archiveBaseDir: join(base, 'archive'),
      encryptionKey: Buffer.alloc(32, 9),
    }).run();
    expect(bad.stats.unreadable).toBe(3);
  });

  it('stops when it is cancelled', async () => {
    const { db, account: acc, base } = seed({ withHash: true });
    const engine = new VerifyEngine(acc, { db, archiveBaseDir: join(base, 'archive') });
    engine.cancel();
    const result = await engine.run();
    expect(result.phase).toBe('cancelled');
  });
});

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ArchiveDatabase } from '../src/db/database.js';
import { writeRegister } from '../src/register/writer.js';
import type { Account, RemoteFolder } from '../src/types.js';

function account(base: string): Account {
  return {
    id: 'acc-1',
    name: 'Privat',
    email: 'privat@example.com',
    host: 'imap.example.com',
    port: 993,
    security: 'tls',
    rejectUnauthorized: true,
    username: 'privat@example.com',
    password: '',
    authType: 'password',
    oauth: null,
    archivePath: null,
    selectedFolders: ['INBOX'],
    settings: {
      concurrency: 2,
      batchSize: 200,
      requestDelayMs: 0,
      sinceDate: null,
      deletedHandling: 'keep',
      deletedRetentionDays: null,
      autoSelectNewFolders: false,
      linkDuplicates: false,
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

function seed() {
  const base = mkdtempSync(join(tmpdir(), 'ma-register-'));
  const db = new ArchiveDatabase(join(base, 'archive.db'));
  const acc = account(base);

  const folder: RemoteFolder = {
    path: 'Projekte/Angebote & Verträge',
    name: 'Angebote & Verträge',
    delimiter: '/',
    specialUse: null,
    noSelect: false,
    messageCount: null,
    sizeBytes: null,
  };
  const row = db.upsertFolder(acc.id, folder, join('Projekte', 'Angebote & Verträge'));
  const folderDir = join(base, 'archive', acc.email, 'Projekte', 'Angebote & Verträge');
  mkdirSync(folderDir, { recursive: true });

  const owner = db.insertMessage({
    accountId: acc.id,
    folderId: row.id,
    uid: 1,
    uidvalidity: 1,
    messageId: '<1@x>',
    fingerprint: 'fp-1',
    internalDate: '2024-03-02T10:00:00.000Z',
    size: 512,
    subject: 'Angebot <Umbau> & mehr',
    fromAddr: 'handwerk@example.com',
    toAddr: 'me@example.com',
    flags: [],
    fileName: '2024-03-02_100000_1_Angebot.eml',
  });
  writeFileSync(
    join(folderDir, '2024-03-02_100000_1_Angebot.eml'),
    'From: handwerk@example.com\r\n\r\nText\r\n',
  );

  // A message that shows here but keeps its bytes with the one above.
  db.insertMessage({
    accountId: acc.id,
    folderId: row.id,
    uid: 2,
    uidvalidity: 1,
    messageId: '<1@x>',
    fingerprint: 'fp-1',
    internalDate: '2024-03-02T10:00:00.000Z',
    size: 512,
    subject: 'Angebot <Umbau> & mehr',
    fromAddr: 'handwerk@example.com',
    toAddr: 'me@example.com',
    flags: [],
    fileName: '2024-03-02_100000_1_Angebot.eml',
    linkedTo: owner,
  });

  return { base, db, account: acc };
}

describe('writeRegister', () => {
  it('writes an overview and a page per folder', async () => {
    const { base, db, account: acc } = seed();
    const result = await writeRegister(acc, { db, archiveBaseDir: join(base, 'archive') });

    expect(result.folders).toBe(1);
    expect(result.messages).toBe(2);

    const overview = readFileSync(result.indexPath, 'utf8');
    expect(overview).toContain('Privat');
    // The ampersand in the folder name has to survive as markup.
    expect(overview).toContain('Angebote &amp; Verträge');
    expect(overview).toContain('/index.html');

    const folderPage = readFileSync(
      join(base, 'archive', 'privat@example.com', 'Projekte', 'Angebote & Verträge', 'index.html'),
      'utf8',
    );
    expect(folderPage).toContain('href="./2024-03-02_100000_1_Angebot.eml"');
    // Angle brackets in a subject must not become tags.
    expect(folderPage).toContain('Angebot &lt;Umbau&gt; &amp; mehr');
    expect(folderPage).not.toContain('<Umbau>');
  });

  it('does not link a message whose file lives elsewhere', async () => {
    const { base, db, account: acc } = seed();
    await writeRegister(acc, { db, archiveBaseDir: join(base, 'archive') });

    const folderPage = readFileSync(
      join(base, 'archive', 'privat@example.com', 'Projekte', 'Angebote & Verträge', 'index.html'),
      'utf8',
    );
    // One row carries a link, the other only the subject.
    expect(folderPage.match(/href="\.\/2024-03-02/g) ?? []).toHaveLength(1);
  });

  it('says so when the archive is encrypted', async () => {
    const { base, db, account: acc } = seed();
    await writeRegister(acc, { db, archiveBaseDir: join(base, 'archive'), encrypted: true });

    const folderPage = readFileSync(
      join(base, 'archive', 'privat@example.com', 'Projekte', 'Angebote & Verträge', 'index.html'),
      'utf8',
    );
    expect(folderPage).toContain('verschlüsselt');
  });
});

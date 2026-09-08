import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ArchiveDatabase } from '../src/db/database.js';
import { buildFolderTree, collectSelected, suggestSelection } from '../src/sync/folders.js';
import type { Account, RemoteFolder } from '../src/types.js';
import { messageFingerprint } from '../src/util/hash.js';

function db(): ArchiveDatabase {
  return new ArchiveDatabase(join(mkdtempSync(join(tmpdir(), 'ma-db-')), 'archive.db'));
}

const REMOTE: RemoteFolder[] = [
  { path: 'INBOX', name: 'INBOX', delimiter: '/', specialUse: '\\Inbox', noSelect: false, messageCount: 3, sizeBytes: null },
  { path: 'Projekte', name: 'Projekte', delimiter: '/', specialUse: null, noSelect: false, messageCount: 1, sizeBytes: null },
  { path: 'Projekte/Rechnungen', name: 'Rechnungen', delimiter: '/', specialUse: null, noSelect: false, messageCount: 2, sizeBytes: null },
  { path: 'Trash', name: 'Trash', delimiter: '/', specialUse: '\\Trash', noSelect: false, messageCount: 1, sizeBytes: null },
  { path: 'Drafts', name: 'Drafts', delimiter: '/', specialUse: '\\Drafts', noSelect: false, messageCount: 0, sizeBytes: null },
  { path: 'Sent', name: 'Sent', delimiter: '/', specialUse: '\\Sent', noSelect: false, messageCount: 1, sizeBytes: null },
];

function account(overrides: Partial<Account> = {}): Account {
  return {
    id: 'acc-1',
    name: 'Test',
    email: 'a@b.c',
    host: 'imap.b.c',
    port: 993,
    security: 'tls',
    rejectUnauthorized: true,
    username: 'a@b.c',
    password: 'pw',
    archivePath: null,
    selectedFolders: [],
    settings: {
      concurrency: 2,
      batchSize: 200,
      requestDelayMs: 0,
      sinceDate: null,
      deletedHandling: 'move-to-deleted',
      deletedRetentionDays: null,
      autoSelectNewFolders: false,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('suggestSelection', () => {
  it('leaves trash, junk and drafts unchecked on first setup', () => {
    expect(suggestSelection(REMOTE).sort()).toEqual(
      ['INBOX', 'Projekte', 'Projekte/Rechnungen', 'Sent'].sort(),
    );
  });
});

describe('buildFolderTree', () => {
  it('nests children under their parent', () => {
    const tree = buildFolderTree({ account: account(), db: db(), remoteFolders: REMOTE });
    const projekte = tree.find((node) => node.path === 'Projekte');
    expect(projekte?.children.map((child) => child.path)).toEqual(['Projekte/Rechnungen']);
    expect(tree.map((node) => node.path)).not.toContain('Projekte/Rechnungen');
  });

  it('marks nothing as new on the very first run', () => {
    const tree = buildFolderTree({ account: account(), db: db(), remoteFolders: REMOTE });
    expect(tree.every((node) => !node.isNew)).toBe(true);
  });

  it('highlights folders that appeared after the first run', () => {
    const database = db();
    for (const folder of REMOTE.slice(0, 3)) {
      database.upsertFolder('acc-1', folder, folder.path);
    }

    const tree = buildFolderTree({
      account: account({ selectedFolders: ['INBOX'] }),
      db: database,
      remoteFolders: REMOTE,
    });

    const sent = tree.find((node) => node.path === 'Sent');
    const inbox = tree.find((node) => node.path === 'INBOX');
    expect(sent?.isNew).toBe(true);
    expect(sent?.selected).toBe(false);
    expect(inbox?.isNew).toBe(false);
    expect(inbox?.selected).toBe(true);
  });

  it('keeps the previous selection instead of the suggestion', () => {
    const database = db();
    for (const folder of REMOTE) database.upsertFolder('acc-1', folder, folder.path);

    const tree = buildFolderTree({
      account: account({ selectedFolders: ['Trash'] }),
      db: database,
      remoteFolders: REMOTE,
    });
    expect(collectSelected(tree)).toEqual(['Trash']);
  });
});

describe('messageFingerprint', () => {
  const base = {
    messageId: '<abc@example.com>',
    internalDate: new Date('2024-01-15T14:30:22Z'),
    fromAddress: 'a@b.c',
    subject: 'Hello',
    size: 1234,
  };

  it('is stable for the same message', () => {
    expect(messageFingerprint(base)).toBe(messageFingerprint({ ...base }));
  });

  it('ignores the subject when a message id is present', () => {
    // A moved message keeps its id; folder specific rewrites of the subject
    // must not break the match.
    expect(messageFingerprint({ ...base, subject: 'different' })).toBe(messageFingerprint(base));
  });

  it('falls back to subject and size without a message id', () => {
    const without = { ...base, messageId: null };
    expect(messageFingerprint(without)).not.toBe(messageFingerprint({ ...without, subject: 'other' }));
  });

  it('separates different messages', () => {
    expect(messageFingerprint({ ...base, size: 99 })).not.toBe(messageFingerprint(base));
  });
});

describe('ArchiveDatabase', () => {
  it('tracks message state across folders', () => {
    const database = db();
    const inbox = database.upsertFolder('acc-1', REMOTE[0] as RemoteFolder, 'INBOX');
    const archive = database.upsertFolder('acc-1', REMOTE[1] as RemoteFolder, 'Projekte');

    const id = database.insertMessage({
      accountId: 'acc-1',
      folderId: inbox.id,
      uid: 10,
      uidvalidity: 1,
      messageId: '<x@y>',
      fingerprint: 'fp-1',
      internalDate: new Date().toISOString(),
      size: 100,
      subject: 'Test',
      fromAddr: 'a@b.c',
      toAddr: 'c@d.e',
      flags: ['\\Seen'],
      fileName: 'x.eml',
    });

    expect(database.countMessages(inbox.id)).toBe(1);
    expect(database.findByFingerprint('acc-1', 'fp-1')).toHaveLength(1);

    database.moveMessage(id, { folderId: archive.id, uid: 5, uidvalidity: 2, fileName: 'y.eml' });
    expect(database.countMessages(inbox.id)).toBe(0);
    expect(database.countMessages(archive.id)).toBe(1);

    database.markDeleted(id);
    expect(database.countMessages(archive.id)).toBe(0);
    expect(database.listDeletedMessages('acc-1')).toHaveLength(1);
  });
});

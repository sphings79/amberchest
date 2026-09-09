import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { ArchiveDatabase } from '../src/db/database.js';
import { searchMessages } from '../src/search/search.js';
import type { RemoteFolder } from '../src/types.js';

/**
 * Mail somebody sent to themselves: a note, a file moved between machines, a
 * reminder. Both ends have to be one of their own addresses, and a header
 * carries a display name around the address, so it is matched as a substring.
 */
describe('sentToSelf', () => {
  let db: ArchiveDatabase;

  const remote: RemoteFolder = {
    path: 'INBOX',
    name: 'INBOX',
    delimiter: '/',
    specialUse: null,
    noSelect: false,
    messageCount: 0,
    sizeBytes: null,
  };

  beforeEach(() => {
    db = new ArchiveDatabase(join(mkdtempSync(join(tmpdir(), 'ac-self-')), 'archive.db'));
    const folder = db.upsertFolder('acc', remote, 'INBOX');

    const add = (uid: number, from: string, to: string): void => {
      db.insertMessage({
        accountId: 'acc',
        folderId: folder.id,
        uid,
        uidvalidity: 1,
        messageId: `<m${uid}@x>`,
        fingerprint: `fp-${uid}`,
        internalDate: '2026-04-01T08:00:00.000Z',
        size: 10,
        subject: `Nachricht ${uid}`,
        fromAddr: from,
        toAddr: to,
        flags: [],
        fileName: `${uid}.eml`,
      });
    };

    add(1, 'Dennis <ich@example.com>', 'Dennis <ich@example.com>');
    add(2, 'ich@example.com', 'alias@example.com');
    add(3, 'fremder@example.com', 'ich@example.com');
    add(4, 'ich@example.com', 'fremder@example.com');
    add(5, 'alias@example.com', 'ich@example.com');
  });

  const find = (addresses: string[]): number[] =>
    searchMessages(db, { query: '', sentToSelf: addresses })
      .hits.map((hit) => hit.messageId)
      .sort();

  it('finds a message from and to the same address, display name and all', () => {
    expect(find(['ich@example.com'])).toEqual([1]);
  });

  it('counts an alias as the same person', () => {
    expect(find(['ich@example.com', 'alias@example.com'])).toEqual([1, 2, 5]);
  });

  it('leaves out what only one end matches', () => {
    const found = find(['ich@example.com', 'alias@example.com']);
    expect(found).not.toContain(3);
    expect(found).not.toContain(4);
  });

  it('does nothing when no address is given', () => {
    expect(searchMessages(db, { query: '', sentToSelf: [] }).total).toBe(5);
  });
});

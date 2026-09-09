import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { ArchiveDatabase } from '../src/db/database.js';
import type { RemoteFolder } from '../src/types.js';

/**
 * The attachment export can be narrowed to folders and to a date range, and
 * either end of the range stands on its own - "everything since the move"
 * needs no upper bound.
 */
describe('listMessagesForExport', () => {
  let db: ArchiveDatabase;
  let inbox: number;
  let sent: number;

  const remote = (path: string): RemoteFolder => ({
    path,
    name: path,
    delimiter: '/',
    specialUse: null,
    noSelect: false,
    messageCount: 0,
    sizeBytes: null,
  });

  beforeEach(() => {
    db = new ArchiveDatabase(join(mkdtempSync(join(tmpdir(), 'ac-range-')), 'archive.db'));
    inbox = db.upsertFolder('acc', remote('INBOX'), 'INBOX').id;
    sent = db.upsertFolder('acc', remote('Sent'), 'Sent').id;

    const add = (folderId: number, uid: number, date: string): void => {
      db.insertMessage({
        accountId: 'acc',
        folderId,
        uid,
        uidvalidity: 1,
        messageId: `<m${uid}@x>`,
        fingerprint: `fp-${uid}`,
        internalDate: date,
        size: 10,
        subject: null,
        fromAddr: null,
        toAddr: null,
        flags: [],
        fileName: `${uid}.eml`,
      });
    };

    add(inbox, 1, '2024-06-01T08:00:00.000Z');
    add(inbox, 2, '2025-01-15T08:00:00.000Z');
    add(inbox, 3, '2026-03-30T08:00:00.000Z');
    add(sent, 4, '2025-07-01T08:00:00.000Z');
  });

  it('returns everything without a filter', () => {
    expect(db.listMessagesForExport('acc')).toHaveLength(4);
  });

  it('narrows to the chosen folders', () => {
    expect(db.listMessagesForExport('acc', [inbox])).toHaveLength(3);
  });

  it('takes a lower bound on its own', () => {
    const rows = db.listMessagesForExport('acc', undefined, { from: '2025-01-01' });
    expect(rows.map((row) => row.uid).sort()).toEqual([2, 3, 4]);
  });

  it('takes an upper bound on its own, up to the end of that day', () => {
    const rows = db.listMessagesForExport('acc', undefined, { to: '2025-01-15' });
    expect(rows.map((row) => row.uid).sort()).toEqual([1, 2]);
  });

  it('combines both ends with a folder', () => {
    const rows = db.listMessagesForExport('acc', [inbox], {
      from: '2024-12-31',
      to: '2025-12-31',
    });
    expect(rows.map((row) => row.uid)).toEqual([2]);
  });
});

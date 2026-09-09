import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { AdoptEngine, type AdoptProgress } from '../src/adopt/engine.js';
import { appSettingsSchema } from '../src/config/schema.js';
import { ArchiveDatabase, type FolderRow, type MessageRow } from '../src/db/database.js';
import { searchMessages } from '../src/search/search.js';
import { discardMessage, undiscardMessage } from '../src/storage/discard.js';
import { readJournal } from '../src/storage/journal.js';
import type { Account, RemoteFolder } from '../src/types.js';

/**
 * Throwing a message out of the archive only means something if it stays out.
 * The mail is still on the server, so the row has to survive as a tombstone -
 * and the journal has to carry the same decision, or rebuilding the index
 * from the files brings the message back on the next run.
 */
describe('discarding a message', () => {
  let db: ArchiveDatabase;
  let account: Account;
  let archive: string;
  let inbox: FolderRow;
  let row: MessageRow;

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
    const base = mkdtempSync(join(tmpdir(), 'ac-tomb-'));
    db = new ArchiveDatabase(join(base, 'archive.db'));
    archive = join(base, 'archive');
    account = {
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
      selectedFolders: ['INBOX'],
      settings: appSettingsSchema.parse({}) as never,
      attachments: { folders: [] } as never,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as Account;

    inbox = db.upsertFolder(account.id, remote('INBOX'), 'INBOX');
    const dir = join(archive, account.email, 'INBOX');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '1.eml'), 'the message');

    const id = db.insertMessage({
      accountId: account.id,
      folderId: inbox.id,
      uid: 1,
      uidvalidity: 7,
      messageId: '<m1@x>',
      fingerprint: 'fp-1',
      internalDate: '2026-04-01T08:00:00.000Z',
      size: 11,
      subject: 'Werbung',
      fromAddr: 'spam@example.com',
      toAddr: 'a@b.c',
      flags: [],
      fileName: '1.eml',
    });
    db.upsertMessageText({
      messageId: id,
      accountId: account.id,
      subject: 'Werbung',
      fromAddr: 'spam@example.com',
      toAddr: 'a@b.c',
      body: 'Unschlagbares Angebot',
      attachmentText: '',
    });
    row = db.listActiveMessages(inbox.id)[0]!;
  });

  const folderDir = (): string => join(archive, account.email, 'INBOX');

  it('deletes the file and keeps a tombstone', async () => {
    await discardMessage(db, account, inbox, row, archive);

    expect(existsSync(join(folderDir(), '1.eml'))).toBe(false);
    expect(db.listActiveMessages(inbox.id)).toHaveLength(0);
    expect([...db.discardedFingerprints(inbox.id)]).toEqual(['fp-1']);
  });

  it('takes it out of the search, with or without deleted messages', async () => {
    expect(searchMessages(db, { query: 'Angebot' }).total).toBe(1);
    await discardMessage(db, account, inbox, row, archive);

    expect(searchMessages(db, { query: 'Angebot' }).total).toBe(0);
    // "Include deleted" means the ones the server lost, not these.
    expect(searchMessages(db, { query: '', includeDeleted: true }).total).toBe(0);
  });

  it('writes the decision to the journal, with what recognises the message', async () => {
    await discardMessage(db, account, inbox, row, archive);

    const records = await readJournal(folderDir());
    const discard = records.find((record) => record.op === 'discard');
    expect(discard).toMatchObject({
      op: 'discard',
      file: '1.eml',
      fingerprint: 'fp-1',
      uid: 1,
      uidvalidity: 7,
      subject: 'Werbung',
    });
  });

  it('is taken back in the index and in the journal', async () => {
    await discardMessage(db, account, inbox, row, archive);
    const messageId = db.listDiscarded(account.id, { limit: 10, offset: 0 }).rows[0]!.id;

    expect(await undiscardMessage(db, account, archive, messageId)).toBe(true);

    // No row at all, so the next backup fetches the mail again. An active row
    // without a file is what the archive check complains about.
    expect(db.listDiscarded(account.id, { limit: 10, offset: 0 }).total).toBe(0);
    expect(db.listActiveMessages(inbox.id)).toHaveLength(0);

    const records = await readJournal(folderDir());
    expect(records.some((record) => record.op === 'undiscard')).toBe(true);
  });

  it('hands a shared file over instead of deleting it', async () => {
    const all = db.upsertFolder(account.id, remote('Alle'), 'Alle');
    db.insertMessage({
      accountId: account.id,
      folderId: all.id,
      uid: 99,
      uidvalidity: 7,
      messageId: '<m1@x>',
      fingerprint: 'fp-1',
      internalDate: '2026-04-01T08:00:00.000Z',
      size: 11,
      subject: 'Werbung',
      fromAddr: 'spam@example.com',
      toAddr: 'a@b.c',
      flags: [],
      fileName: '1.eml',
      linkedTo: row.id,
    });

    const result = await discardMessage(db, account, inbox, row, archive);

    expect(result.handedOver).toBe(true);
    const survivor = db.listActiveMessages(all.id)[0]!;
    expect(survivor.linked_to).toBeNull();
    expect(await readFile(join(archive, account.email, 'Alle', survivor.file_name), 'utf8')).toBe(
      'the message',
    );
  });
});

describe('the list behind the tombstones', () => {
  it('filters by folder and by text', () => {
    const db = new ArchiveDatabase(join(mkdtempSync(join(tmpdir(), 'ac-list-')), 'archive.db'));
    const remote = (path: string): RemoteFolder => ({
      path,
      name: path,
      delimiter: '/',
      specialUse: null,
      noSelect: false,
      messageCount: 0,
      sizeBytes: null,
    });
    const inbox = db.upsertFolder('acc', remote('INBOX'), 'INBOX');
    const junk = db.upsertFolder('acc', remote('Junk'), 'Junk');

    const add = (folderId: number, uid: number, subject: string): void => {
      const id = db.insertMessage({
        accountId: 'acc',
        folderId,
        uid,
        uidvalidity: 1,
        messageId: `<m${uid}@x>`,
        fingerprint: `fp-${uid}`,
        internalDate: `2026-04-0${uid}T08:00:00.000Z`,
        size: 10,
        subject,
        fromAddr: 'a@b.c',
        toAddr: 'd@e.f',
        flags: [],
        fileName: `${uid}.eml`,
      });
      db.discardMessage(id);
    };

    add(inbox.id, 1, 'Newsletter März');
    add(inbox.id, 2, 'Rechnung');
    add(junk.id, 3, 'Newsletter April');

    expect(db.listDiscarded('acc', { limit: 50, offset: 0 }).total).toBe(3);
    expect(db.listDiscarded('acc', { folderPath: 'INBOX', limit: 50, offset: 0 }).total).toBe(2);
    expect(db.listDiscarded('acc', { search: 'Newsletter', limit: 50, offset: 0 }).total).toBe(2);
    expect(
      db.listDiscarded('acc', { search: 'Newsletter', folderPath: 'Junk', limit: 50, offset: 0 })
        .total,
    ).toBe(1);

    expect(db.undiscardAll('acc', 'INBOX')).toBe(2);
    expect(db.listDiscarded('acc', { limit: 50, offset: 0 }).total).toBe(1);
    expect(db.undiscardAll('acc')).toBe(1);
  });
});

describe('rebuilding the index from the files', () => {
  /**
   * The point of writing the decision to the journal: an index rebuilt from
   * the archive - which is what adopting is, and what the far side of a move
   * does - has to arrive at the same answer. Otherwise the first backup after
   * a rebuild fetches back everything somebody threw away.
   */
  async function adopt(archive: string, account: Account, db: ArchiveDatabase): Promise<AdoptProgress> {
    const engine = new AdoptEngine(account, { db, archiveBaseDir: archive });
    return engine.run();
  }

  it('keeps a discarded message out, and lets an undo through', async () => {
    const base = mkdtempSync(join(tmpdir(), 'ac-adopt-'));
    const archive = join(base, 'archive');
    const account = {
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
      selectedFolders: ['INBOX'],
      settings: appSettingsSchema.parse({}) as never,
      attachments: { folders: [] } as never,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as Account;

    // An archive as it looks after one message was kept and one was thrown out:
    // only the kept file is on disk, and the journal says why the other is not.
    const dir = join(archive, account.email, 'INBOX');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'keep.eml'), 'From: a@b.c\r\nSubject: Bleibt\r\n\r\nText');

    const meta = {
      uid: 1,
      uidvalidity: 5,
      messageId: '<keep@x>',
      fingerprint: 'fp-keep',
      internalDate: '2026-04-01T08:00:00.000Z',
      size: 40,
      subject: 'Bleibt',
      from: 'a@b.c',
      to: 'd@e.f',
      flags: [],
    };
    const lines = [
      { op: 'folder', ts: '2026-04-01T08:00:00.000Z', path: 'INBOX', delimiter: '/', specialUse: null, uidvalidity: 5 },
      { op: 'add', ts: '2026-04-01T08:00:00.000Z', file: 'keep.eml', ...meta },
      { op: 'add', ts: '2026-04-01T08:00:00.000Z', file: 'gone.eml', ...meta, uid: 2, fingerprint: 'fp-gone', subject: 'Geworfen' },
      { op: 'discard', ts: '2026-04-02T08:00:00.000Z', file: 'gone.eml', uid: 2, uidvalidity: 5, messageId: '<gone@x>', fingerprint: 'fp-gone', internalDate: '2026-04-01T08:00:00.000Z', size: 40, subject: 'Geworfen', from: 'a@b.c', to: 'd@e.f' },
    ];
    writeFileSync(join(dir, '.amberchest.jsonl'), lines.map((line) => JSON.stringify(line)).join('\n') + '\n');

    const db = new ArchiveDatabase(join(base, 'archive.db'));
    await adopt(archive, account, db);

    const folder = db.listFolders(account.id)[0]!;
    expect(db.listActiveMessages(folder.id).map((row) => row.subject)).toEqual(['Bleibt']);
    // The decision survived, so the next backup leaves the mail alone.
    expect([...db.discardedFingerprints(folder.id)]).toEqual(['fp-gone']);

    // And an undo in the journal is honoured by a later rebuild.
    writeFileSync(
      join(dir, '.amberchest.jsonl'),
      [...lines, { op: 'undiscard', ts: '2026-04-03T08:00:00.000Z', fingerprint: 'fp-gone' }]
        .map((line) => JSON.stringify(line))
        .join('\n') + '\n',
    );
    const second = new ArchiveDatabase(join(base, 'archive2.db'));
    await adopt(archive, account, second);
    const folder2 = second.listFolders(account.id)[0]!;
    expect([...second.discardedFingerprints(folder2.id)]).toEqual([]);
  });
});

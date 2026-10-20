import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { appSettingsSchema } from '../src/config/schema.js';
import { ArchiveDatabase } from '../src/db/database.js';
import { DedupeEngine, planDedupe } from '../src/dedupe/engine.js';
import { readJournal } from '../src/storage/journal.js';
import type { Account, RemoteFolder } from '../src/types.js';
import { sha256 } from '../src/util/hash.js';

/**
 * Gmail keeps a mail in its folder and in All Mail, so an archive made without
 * "Store a message only once" holds the bytes twice. Merging has to turn the
 * second copy into a link without ever deleting a file it has not proven to be
 * the same.
 */
function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'ac-dedupe-'));
  const db = new ArchiveDatabase(join(base, 'archive.db'));
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
    selectedFolders: ['INBOX', 'Alle Nachrichten'],
    settings: appSettingsSchema.parse({}) as never,
    attachments: { folders: [] } as never,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as Account;

  const remote = (path: string): RemoteFolder => ({
    path,
    name: path,
    delimiter: '/',
    specialUse: null,
    noSelect: false,
    messageCount: 0,
    sizeBytes: null,
  });
  const all = db.upsertFolder(account.id, remote('Alle Nachrichten'), 'Alle Nachrichten');
  const inbox = db.upsertFolder(account.id, remote('INBOX'), 'INBOX');

  const add = (
    folder: { id: number; local_path: string },
    uid: number,
    fingerprint: string,
    body: string,
    options: { checksum?: string | null; fileName?: string } = {},
  ): number => {
    const fileName = options.fileName ?? `${folder.local_path}-${uid}.eml`;
    const dir = join(archive, account.email, folder.local_path);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, fileName), body);
    return db.insertMessage({
      accountId: account.id,
      folderId: folder.id,
      uid,
      uidvalidity: 1,
      messageId: `<m${uid}@x>`,
      fingerprint,
      internalDate: '2026-04-01T08:00:00.000Z',
      size: Buffer.byteLength(body),
      subject: `Nachricht ${uid}`,
      fromAddr: 'a@b.c',
      toAddr: 'd@e.f',
      flags: [],
      fileName,
      sha256: options.checksum === undefined ? sha256(Buffer.from(body)) : options.checksum,
    });
  };

  const engine = () => new DedupeEngine(account, { db, archiveBaseDir: archive });
  const dir = (folder: { local_path: string }) => join(archive, account.email, folder.local_path);
  return { db, archive, account, inbox, all, add, engine, dir };
}

describe('merging duplicate copies', () => {
  it('turns the copy in the later folder into a link and deletes its file', async () => {
    const { db, all, inbox, add, engine, dir } = fixture();
    const owner = add(all, 10, 'fp-1', 'same bytes');
    const copy = add(inbox, 3, 'fp-1', 'same bytes');

    const result = await engine().run();

    expect(result.phase).toBe('done');
    expect(result.stats.merged).toBe(1);
    expect(result.stats.bytesFreed).toBe(Buffer.byteLength('same bytes'));

    const row = db.getMessage(copy)!;
    expect(row.linked_to).toBe(owner);
    expect(row.file_name).toBe(db.getMessage(owner)!.file_name);
    expect(row.state).toBe('active');
    expect(row.uid).toBe(3);
    expect(existsSync(join(dir(inbox), 'INBOX-3.eml'))).toBe(false);
    expect(existsSync(join(dir(all), 'Alle Nachrichten-10.eml'))).toBe(true);
    expect(readFileSync(join(dir(all), db.getMessage(owner)!.file_name), 'utf8')).toBe('same bytes');
  });

  it('keeps the journal rebuildable: the old file is purged, the link points at the owner', async () => {
    const { all, inbox, add, engine, dir } = fixture();
    add(all, 10, 'fp-1', 'same bytes');
    add(inbox, 3, 'fp-1', 'same bytes');
    await engine().run();

    const records = await readJournal(dir(inbox));
    const purge = records.find((record) => record.op === 'remove');
    const link = records.find((record) => record.op === 'link');
    expect(purge).toMatchObject({ file: 'INBOX-3.eml', reason: 'purged' });
    expect(link).toMatchObject({
      file: 'Alle Nachrichten-10.eml',
      target: 'Alle Nachrichten/Alle Nachrichten-10.eml',
      uid: 3,
      fingerprint: 'fp-1',
    });
  });

  it('lets the oldest row keep the bytes', async () => {
    const { db, all, inbox, add, engine } = fixture();
    const first = add(inbox, 3, 'fp-1', 'same bytes');
    const second = add(all, 10, 'fp-1', 'same bytes');
    await engine().run();

    expect(db.getMessage(first)!.linked_to).toBeNull();
    expect(db.getMessage(second)!.linked_to).toBe(first);
  });

  it('leaves a copy alone when its bytes differ', async () => {
    const { db, all, inbox, add, engine, dir } = fixture();
    add(all, 10, 'fp-1', 'one version');
    const other = add(inbox, 3, 'fp-1', 'another version');

    const result = await engine().run();

    expect(result.stats.merged).toBe(0);
    expect(result.stats.differing).toBe(1);
    expect(db.getMessage(other)!.linked_to).toBeNull();
    expect(existsSync(join(dir(inbox), 'INBOX-3.eml'))).toBe(true);
  });

  it('leaves a copy alone when a checksum is missing', async () => {
    const { db, all, inbox, add, engine, dir } = fixture();
    add(all, 10, 'fp-1', 'same bytes');
    const copy = add(inbox, 3, 'fp-1', 'same bytes', { checksum: null });

    const result = await engine().run();

    expect(result.stats.merged).toBe(0);
    expect(result.stats.noChecksum).toBe(1);
    expect(db.getMessage(copy)!.linked_to).toBeNull();
    expect(existsSync(join(dir(inbox), 'INBOX-3.eml'))).toBe(true);
  });

  it('does not delete a copy whose file no longer matches its checksum', async () => {
    const { db, all, inbox, add, engine, dir } = fixture();
    add(all, 10, 'fp-1', 'same bytes');
    const copy = add(inbox, 3, 'fp-1', 'same bytes');
    writeFileSync(join(dir(inbox), 'INBOX-3.eml'), 'damaged');

    const result = await engine().run();

    expect(result.stats.merged).toBe(0);
    expect(result.stats.notVerified).toBe(1);
    expect(db.getMessage(copy)!.linked_to).toBeNull();
    expect(readFileSync(join(dir(inbox), 'INBOX-3.eml'), 'utf8')).toBe('damaged');
  });

  it('merges nothing when the owner itself is damaged', async () => {
    const { db, all, inbox, add, engine, dir } = fixture();
    add(all, 10, 'fp-1', 'same bytes');
    const copy = add(inbox, 3, 'fp-1', 'same bytes');
    writeFileSync(join(dir(all), 'Alle Nachrichten-10.eml'), 'damaged');

    const result = await engine().run();

    expect(result.stats.merged).toBe(0);
    expect(result.stats.notVerified).toBe(1);
    expect(db.getMessage(copy)!.linked_to).toBeNull();
  });

  it('leaves two copies in the same folder alone', async () => {
    const { db, all, add, engine } = fixture();
    add(all, 10, 'fp-1', 'same bytes');
    const twin = add(all, 11, 'fp-1', 'same bytes');

    const result = await engine().run();

    expect(result.stats.candidates).toBe(0);
    expect(db.getMessage(twin)!.linked_to).toBeNull();
  });

  it('points links that relied on a merged copy at the new owner', async () => {
    const { db, all, inbox, add, engine } = fixture();
    const owner = add(all, 10, 'fp-1', 'same bytes');
    const copy = add(inbox, 3, 'fp-1', 'same bytes');
    const third = db.upsertFolder('acc-1', {
      path: 'Wichtig', name: 'Wichtig', delimiter: '/', specialUse: null, noSelect: false, messageCount: 0, sizeBytes: null,
    }, 'Wichtig');
    // A row that already pointed at the copy that is about to become a link.
    const dependent = db.insertMessage({
      accountId: 'acc-1', folderId: third.id, uid: 5, uidvalidity: 1, messageId: '<m5@x>',
      fingerprint: 'fp-other', internalDate: '2026-04-01T08:00:00.000Z', size: 10, subject: 's',
      fromAddr: null, toAddr: null, flags: [], fileName: 'INBOX-3.eml', sha256: null, linkedTo: copy,
    });

    await engine().run();

    expect(db.getMessage(dependent)!.linked_to).toBe(owner);
  });

  it('can be planned without touching anything', () => {
    const { all, inbox, add, db, account } = fixture();
    add(all, 10, 'fp-1', 'same bytes');
    add(inbox, 3, 'fp-1', 'same bytes');
    add(inbox, 4, 'fp-2', 'only here');

    const plan = planDedupe(db, account.id);

    expect(plan.messages).toBe(1);
    expect(plan.bytes).toBe(Buffer.byteLength('same bytes'));
    expect(plan.folders).toEqual([{ path: 'INBOX', messages: 1, bytes: Buffer.byteLength('same bytes') }]);
  });

  it('stops when cancelled and keeps what was merged', async () => {
    const { db, all, inbox, add, engine } = fixture();
    add(all, 10, 'fp-1', 'same bytes');
    const copy = add(inbox, 3, 'fp-1', 'same bytes');
    const run = engine();
    run.cancel();

    const result = await run.run();

    expect(result.phase).toBe('cancelled');
    expect(db.getMessage(copy)!.linked_to).toBeNull();
  });
});

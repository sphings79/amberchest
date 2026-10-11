import { existsSync, mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ArchiveDatabase } from '../src/db/database.js';
import { discardFolder, discardMessage, undiscardMessage } from '../src/storage/discard.js';
import { searchMessageRefs, searchMessages } from '../src/search/search.js';
import { appSettingsSchema } from '../src/config/schema.js';
import type { Account, RemoteFolder } from '../src/types.js';

/**
 * Discarding a folder deletes files, which makes the one case worth testing
 * the one where a file does not belong to the folder alone: a message stored
 * once and shown in two folders, as Gmail delivers it. Taking that file with
 * the folder would leave the other one pointing at nothing.
 */
function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'ac-discard-'));
  const db = new ArchiveDatabase(join(base, 'archive.db'));
  const archive = join(base, 'archive');

  const account: Account = {
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

  const inbox = db.upsertFolder(account.id, remote('INBOX'), 'INBOX');
  const all = db.upsertFolder(account.id, remote('Alle Nachrichten'), 'Alle Nachrichten');

  return { base, db, archive, account, inbox, all };
}

function writeMessage(dir: string, name: string, body: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), body);
}

describe('discardFolder', () => {
  it('removes the files and the index entries', async () => {
    const { db, archive, account, inbox } = fixture();
    const dir = join(archive, account.email, 'INBOX');
    writeMessage(dir, '1.eml', 'one');
    writeMessage(dir, '2.eml', 'two');

    for (const uid of [1, 2]) {
      db.insertMessage({
        accountId: account.id,
        folderId: inbox.id,
        uid,
        uidvalidity: 1,
        messageId: `<m${uid}@x>`,
        fingerprint: `fp-${uid}`,
        internalDate: '2026-04-01T08:00:00.000Z',
        size: 100,
        subject: `Nachricht ${uid}`,
        fromAddr: 'a@b.c',
        toAddr: 'd@e.f',
        flags: [],
        fileName: `${uid}.eml`,
      });
    }

    const result = await discardFolder(db, account, inbox, archive);

    expect(result.messages).toBe(2);
    expect(result.handedOver).toBe(0);
    expect(result.bytes).toBe(200);
    expect(existsSync(dir)).toBe(false);
    expect(db.listFolders(account.id).map((f) => f.path)).toEqual(['Alle Nachrichten']);
  });

  it('hands a shared file to the folder that only pointed at it', async () => {
    const { db, archive, account, inbox, all } = fixture();
    const inboxDir = join(archive, account.email, 'INBOX');
    writeMessage(inboxDir, '1.eml', 'the only copy');

    const ownerId = db.insertMessage({
      accountId: account.id,
      folderId: inbox.id,
      uid: 1,
      uidvalidity: 1,
      messageId: '<shared@x>',
      fingerprint: 'fp-shared',
      internalDate: '2026-04-01T08:00:00.000Z',
      size: 100,
      subject: 'Zweimal abgelegt',
      fromAddr: 'a@b.c',
      toAddr: 'd@e.f',
      flags: [],
      fileName: '1.eml',
    });

    // The second folder shows the same message without a second file.
    db.insertMessage({
      accountId: account.id,
      folderId: all.id,
      uid: 77,
      uidvalidity: 1,
      messageId: '<shared@x>',
      fingerprint: 'fp-shared',
      internalDate: '2026-04-01T08:00:00.000Z',
      size: 100,
      subject: 'Zweimal abgelegt',
      fromAddr: 'a@b.c',
      toAddr: 'd@e.f',
      flags: [],
      fileName: '1.eml',
      linkedTo: ownerId,
    });

    const result = await discardFolder(db, account, inbox, archive);

    expect(result.handedOver).toBe(1);
    expect(existsSync(inboxDir)).toBe(false);

    // The survivor owns a real file now, not a link.
    const survivors = db.listActiveMessages(all.id);
    expect(survivors).toHaveLength(1);
    expect(survivors[0]!.linked_to).toBeNull();
    expect(existsSync(join(archive, account.email, 'Alle Nachrichten', survivors[0]!.file_name))).toBe(
      true,
    );
  });

  it('takes the message out of the search index with it', async () => {
    const { db, archive, account, inbox } = fixture();
    writeMessage(join(archive, account.email, 'INBOX'), '1.eml', 'x');
    const id = db.insertMessage({
      accountId: account.id,
      folderId: inbox.id,
      uid: 1,
      uidvalidity: 1,
      messageId: '<m1@x>',
      fingerprint: 'fp-1',
      internalDate: '2026-04-01T08:00:00.000Z',
      size: 10,
      subject: 'Stromabrechnung',
      fromAddr: 'a@b.c',
      toAddr: 'd@e.f',
      flags: [],
      fileName: '1.eml',
    });
    db.upsertMessageText({
      messageId: id,
      accountId: account.id,
      subject: 'Stromabrechnung',
      fromAddr: 'a@b.c',
      toAddr: 'd@e.f',
      body: 'Ihre Abrechnung liegt bei',
      attachmentText: '',
    });

    const find = (): number => searchMessages(db, { query: 'Stromabrechnung' }).total;
    expect(find()).toBe(1);
    await discardFolder(db, account, inbox, archive);
    expect(find()).toBe(0);
  });
});

describe('bulk discard by search', () => {
  function seed(count: number) {
    const f = fixture();
    const dir = join(f.archive, f.account.email, 'INBOX');
    const ids: number[] = [];
    for (let uid = 1; uid <= count; uid += 1) {
      writeMessage(dir, `${uid}.eml`, `mail ${uid}`);
      ids.push(
        f.db.insertMessage({
          accountId: f.account.id,
          folderId: f.inbox.id,
          uid,
          uidvalidity: 1,
          messageId: `<m${uid}@x>`,
          fingerprint: `fp-${uid}`,
          internalDate: '2026-04-01T08:00:00.000Z',
          size: 10,
          subject: uid % 2 === 0 ? 'Newsletter' : 'Rechnung',
          fromAddr: uid % 2 === 0 ? 'news@shop.example' : 'a@b.c',
          toAddr: 'd@e.f',
          flags: [],
          fileName: `${uid}.eml`,
        }),
      );
    }
    return { ...f, dir, ids };
  }

  it('lists every match without paging, in a stable order', () => {
    const { db } = seed(6);
    const all = searchMessageRefs(db, { query: '', from: 'news@shop.example' }, 100);
    expect(all.total).toBe(3);
    expect(all.refs).toHaveLength(3);

    const capped = searchMessageRefs(db, { query: '', from: 'news@shop.example' }, 2);
    expect(capped.total).toBe(3);
    expect(capped.refs.map((r) => r.messageId)).toEqual(all.refs.slice(0, 2).map((r) => r.messageId));

    expect(searchMessageRefs(db, { query: '' }, 0)).toEqual({ refs: [], total: 6 });
  });

  it('shrinks the match set as messages are discarded, so batches make progress', async () => {
    const { db, account, inbox, archive } = seed(6);
    const options = { query: '', from: 'news@shop.example' };

    const first = searchMessageRefs(db, options, 2);
    for (const ref of first.refs) {
      await discardMessage(db, account, inbox, db.getMessage(ref.messageId)!, archive);
    }
    const second = searchMessageRefs(db, options, 2);
    expect(second.total).toBe(1);
    expect(second.refs.map((r) => r.messageId)).not.toContain(first.refs[0]!.messageId);
  });

  it('leaves the messages that do not match alone', async () => {
    const { db, account, inbox, archive, dir } = seed(4);
    for (const ref of searchMessageRefs(db, { query: '', from: 'news@shop.example' }, 100).refs) {
      await discardMessage(db, account, inbox, db.getMessage(ref.messageId)!, archive);
    }
    expect(searchMessageRefs(db, { query: '' }, 0).total).toBe(2);
    expect(existsSync(join(dir, '1.eml'))).toBe(true);
    expect(existsSync(join(dir, '2.eml'))).toBe(false);
  });

  it('lists tombstones for taking back and forgets them', async () => {
    const { db, account, inbox, archive, ids } = seed(3);
    await discardMessage(db, account, inbox, db.getMessage(ids[0]!)!, archive);
    await discardMessage(db, account, inbox, db.getMessage(ids[1]!)!, archive);

    const listed = db.listDiscarded(account.id, { limit: 10, offset: 0 });
    expect(listed.total).toBe(2);

    for (const row of listed.rows) await undiscardMessage(db, account, archive, row.id);
    expect(db.listDiscarded(account.id, { limit: 10, offset: 0 }).total).toBe(0);
  });
});

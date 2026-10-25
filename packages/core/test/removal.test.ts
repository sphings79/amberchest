import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { appSettingsSchema } from '../src/config/schema.js';
import { ArchiveDatabase } from '../src/db/database.js';
import { AdoptEngine } from '../src/adopt/engine.js';
import { RemovalEngine, planRemoval } from '../src/removal/engine.js';
import { readJournal } from '../src/storage/journal.js';
import type { Account, RemoteFolder } from '../src/types.js';
import { messageFingerprint } from '../src/util/hash.js';

/**
 * Deleting mail on a server is the one thing that cannot be taken back, so
 * the tests are about what it refuses to do.
 */

interface ServerMessage {
  uid: number;
  messageId: string;
  subject: string;
  from: string;
  size: number;
  internalDate: Date;
}

function fixture(options: { allowRemoval?: boolean } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'ac-removal-'));
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
    selectedFolders: ['INBOX'],
    settings: {
      ...(appSettingsSchema.parse({}) as object),
      allowServerRemoval: options.allowRemoval ?? true,
    } as never,
    attachments: { folders: [] } as never,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as Account;

  const remote: RemoteFolder = {
    path: 'INBOX',
    name: 'INBOX',
    delimiter: '/',
    specialUse: null,
    noSelect: false,
    messageCount: 0,
    sizeBytes: null,
  };
  const folder = db.upsertFolder(account.id, remote, 'INBOX');
  const dir = join(archive, account.email, 'INBOX');
  mkdirSync(dir, { recursive: true });

  const server: ServerMessage[] = [];
  const rows: number[] = [];

  /** Archives a message and puts the same one on the fake server. */
  function add(uid: number, extra: { withHash?: boolean; body?: string; uidvalidity?: number } = {}) {
    const body = extra.body ?? `Subject: m${uid}\r\n\r\nbody ${uid}\r\n`;
    writeFileSync(join(dir, `${uid}.eml`), body);
    const message: ServerMessage = {
      uid,
      messageId: `<m${uid}@x>`,
      subject: `m${uid}`,
      from: 'a@b.c',
      size: body.length,
      internalDate: new Date('2024-03-01T08:00:00.000Z'),
    };
    server.push(message);
    const id = db.insertMessage({
      accountId: account.id,
      folderId: folder.id,
      uid,
      uidvalidity: extra.uidvalidity ?? 1,
      messageId: message.messageId,
      fingerprint: messageFingerprint({
        messageId: message.messageId,
        internalDate: message.internalDate,
        fromAddress: message.from,
        subject: message.subject,
        size: message.size,
      }),
      internalDate: message.internalDate.toISOString(),
      size: message.size,
      subject: message.subject,
      fromAddr: message.from,
      toAddr: 'x@y.z',
      flags: [],
      fileName: `${uid}.eml`,
      sha256: extra.withHash === false ? null : createHash('sha256').update(body).digest('hex'),
    });
    rows.push(id);
    return id;
  }

  /** A stand-in for ImapFlow with exactly the calls the engine makes. */
  function client(
    capabilities: string[] = ['IMAP4rev1', 'UIDPLUS'],
    uidValidity = 1,
    /** UIDs the fake keeps listing after they were deleted, like a provider's trash. */
    keepListed: number[] = [],
  ) {
    const deleted: number[] = [];
    const calls: string[] = [];
    const stub = {
      capabilities: new Set(capabilities),
      async mailboxOpen(_path: string, opts: { readOnly: boolean }) {
        calls.push(`open readOnly=${opts.readOnly}`);
        return { uidValidity: BigInt(uidValidity) };
      },
      async *fetch(range: string) {
        const wanted = new Set(
          range.split(',').flatMap((part) => {
            const [a, b] = part.split(':').map(Number) as [number, number | undefined];
            return b === undefined ? [a] : Array.from({ length: b - a + 1 }, (_, i) => a + i);
          }),
        );
        for (const m of server) {
          if (!wanted.has(m.uid)) continue;
          yield {
            uid: m.uid,
            internalDate: m.internalDate,
            size: m.size,
            envelope: {
              messageId: m.messageId,
              subject: m.subject,
              from: [{ address: m.from }],
            },
          };
        }
      },
      async messageDelete(range: string) {
        calls.push(`delete ${range}`);
        for (const part of range.split(',')) {
          const [a, b] = part.split(':').map(Number) as [number, number | undefined];
          for (let uid = a; uid <= (b ?? a); uid += 1) deleted.push(uid);
        }
        return true;
      },
      async messageFlagsRemove() {
        return true;
      },
      async search(query: { uid: string }) {
        const wanted = new Set(
          query.uid.split(',').flatMap((part) => {
            const [a, b] = part.split(':').map(Number) as [number, number | undefined];
            return b === undefined ? [a] : Array.from({ length: b - a + 1 }, (_, i) => a + i);
          }),
        );
        return server
          .map((m) => m.uid)
          .filter((uid) => wanted.has(uid) && (!deleted.includes(uid) || keepListed.includes(uid)));
      },
    };
    return { stub, deleted, calls };
  }

  const engine = (
    stub: unknown,
    request: ConstructorParameters<typeof RemovalEngine>[2] = { pauseMs: 0 },
  ) =>
    new RemovalEngine(
      account,
      {
        db,
        archiveBaseDir: archive,
        connection: {} as never,
        connect: async (_options, fn) => fn(stub as never),
      },
      { pauseMs: 0, ...request },
    );

  return { db, account, add, client, engine, dir, rows, server };
}

describe('server removal', () => {
  it('deletes verified messages by UID and marks them', async () => {
    const f = fixture();
    const a = f.add(1);
    const b = f.add(2);
    const { stub, deleted, calls } = f.client();

    const result = await f.engine(stub).run();

    expect(result.phase).toBe('done');
    expect(result.stats.removed).toBe(2);
    expect(deleted.sort()).toEqual([1, 2]);
    // Opened for writing, and deleted by UID rather than by position.
    expect(calls[0]).toBe('open readOnly=false');
    expect(f.db.getMessage(a)?.server_removed_at).not.toBeNull();
    expect(f.db.getMessage(b)?.server_removed_at).not.toBeNull();
    // Still archived: removing it from the server must not touch the copy.
    expect(f.db.getMessage(a)?.state).toBe('active');
  });

  it('does not count a message the server still lists after deleting it', async () => {
    const f = fixture();
    const kept = f.add(1);
    const gone = f.add(2);
    const { stub } = f.client(undefined, 1, [1]);

    const result = await f.engine(stub).run();

    expect(result.stats.removed).toBe(1);
    expect(result.stats.stillOnServer).toBe(1);
    // Not marked as removed: it is on the server, so the backup keeps it.
    expect(f.db.getMessage(kept)?.server_removed_at).toBeNull();
    expect(f.db.getMessage(gone)?.server_removed_at).not.toBeNull();
  });

  it('does nothing when the account has not allowed it', async () => {
    const f = fixture({ allowRemoval: false });
    f.add(1);
    const { stub, deleted } = f.client();

    const result = await f.engine(stub).run();

    expect(result.phase).toBe('failed');
    expect(deleted).toEqual([]);
  });

  it('refuses a server without UIDPLUS before it flags anything', async () => {
    const f = fixture();
    f.add(1);
    const { stub, deleted, calls } = f.client(['IMAP4rev1']);

    const result = await f.engine(stub).run();

    expect(result.phase).toBe('failed');
    expect(result.error).toMatch(/UIDPLUS/);
    expect(deleted).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('leaves a message alone whose archived file no longer matches', async () => {
    const f = fixture();
    f.add(1);
    const tampered = f.add(2, { body: 'original' });
    writeFileSync(join(f.dir, '2.eml'), 'something else entirely');
    const { stub, deleted } = f.client();

    const result = await f.engine(stub).run();

    expect(deleted).toEqual([1]);
    expect(result.stats.notVerified).toBe(1);
    expect(f.db.getMessage(tampered)?.server_removed_at).toBeNull();
  });

  it('leaves a message alone that has no checksum yet', async () => {
    const f = fixture();
    f.add(1, { withHash: false });
    const { stub, deleted } = f.client();

    const result = await f.engine(stub).run();

    expect(deleted).toEqual([]);
    expect(result.stats.noChecksum).toBe(1);
  });

  it('leaves a message alone when the file is gone', async () => {
    const f = fixture();
    f.add(1);
    const { unlinkSync } = await import('node:fs');
    unlinkSync(join(f.dir, '1.eml'));
    const { stub, deleted } = f.client();

    const result = await f.engine(stub).run();

    expect(deleted).toEqual([]);
    expect(result.stats.notVerified).toBe(1);
  });

  it('says which part of a message differs, without its subject or addresses', async () => {
    const f = fixture();
    f.add(1);
    f.server[0]!.size += 19;
    f.server[0]!.subject = 'a secret subject';
    f.server[0]!.from = 'someone@secret.example';
    const { stub } = f.client();

    const { logger } = await import('../src/util/logger.js');
    logger.setLevel('debug');
    const result = await f.engine(stub).run();
    const text = logger
      .recent(50)
      .map((entry) => entry.message)
      .join('\n');

    expect(result.stats.changedOnServer).toBe(1);
    expect(text).toContain('INBOX UID 1 is not the archived message: differs in');
    expect(text).toContain('size (stored');
    expect(text).toContain('sender (different)');
    expect(text).not.toContain('secret');
  });

  it('says which side is empty when the message ID or the sender is missing', async () => {
    const { describeDifferences } = await import('../src/removal/engine.js');
    const server = {
      messageId: '<a@x>',
      internalDate: new Date('2024-03-01T08:00:00.000Z'),
      fromAddress: 'a@b.c',
      subject: 's',
      size: 10,
    };
    const stored = {
      message_id: null,
      internal_date: '2024-03-01T08:00:00.000Z',
      size: 10,
      from_addr: null,
      subject: 's',
    };
    expect(describeDifferences(stored, server)).toBe(
      'differs in Message-ID (empty in the archive, set on the server), sender (empty in the archive, set on the server)',
    );
    expect(describeDifferences({ ...stored, message_id: '<a@x>', from_addr: 'a@b.c' }, { ...server, messageId: null, fromAddress: null })).toBe(
      'differs in Message-ID (set in the archive, empty on the server), sender (set in the archive, empty on the server)',
    );
  });

  it('counts a message missing on the server as left alone in the summary', async () => {
    const f = fixture();
    f.add(1);
    f.server.length = 0;
    const { stub } = f.client();

    const result = await f.engine(stub).run();

    expect(result.stats.alreadyGone).toBe(1);
    const { logger } = await import('../src/util/logger.js');
    expect(logger.recent(5).map((entry) => entry.message).join('\n')).toContain('1 left alone');
  });

  it('does not trust a UID that now names a different message', async () => {
    const f = fixture();
    f.add(1);
    // The server renumbered: UID 1 is somebody else's mail now.
    f.server[0]!.messageId = '<someone-else@x>';
    const { stub, deleted } = f.client();

    const result = await f.engine(stub).run();

    expect(deleted).toEqual([]);
    expect(result.stats.changedOnServer).toBe(1);
  });

  it('leaves a folder alone whose UIDVALIDITY changed', async () => {
    const f = fixture();
    f.add(1);
    const { stub, deleted } = f.client(['UIDPLUS'], 2);

    const result = await f.engine(stub).run();

    expect(deleted).toEqual([]);
    expect(result.stats.skippedFolders).toBe(1);
  });

  it('counts a message already gone from the server instead of failing', async () => {
    const f = fixture();
    f.add(1);
    f.server.length = 0;
    const { stub } = f.client();

    const result = await f.engine(stub).run();

    expect(result.phase).toBe('done');
    expect(result.stats.alreadyGone).toBe(1);
    expect(result.stats.removed).toBe(0);
  });

  it('does not offer a message twice', async () => {
    const f = fixture();
    f.add(1);
    const first = f.client();
    await f.engine(first.stub).run();

    const second = f.client();
    const result = await f.engine(second.stub).run();

    expect(second.deleted).toEqual([]);
    expect(result.stats.candidates).toBe(0);
  });

  it('only takes the mail old enough', async () => {
    const f = fixture();
    f.add(1);
    const { stub, deleted } = f.client();

    // The fixture message is from 2024; asking for older than 100 years leaves it.
    const result = await f.engine(stub, { pauseMs: 0, olderThanDays: 36_500 }).run();

    expect(deleted).toEqual([]);
    expect(result.stats.candidates).toBe(0);
  });

  it('plans from the index alone', () => {
    const f = fixture();
    f.add(1);
    f.add(2, { withHash: false });

    const plan = planRemoval(f.db, f.account.id);

    expect(plan.messages).toBe(2);
    expect(plan.noChecksum).toBe(1);
    expect(plan.folders).toEqual([expect.objectContaining({ path: 'INBOX', messages: 2 })]);
  });

  it('writes the removal to the journal, and marks before it deletes', async () => {
    const f = fixture();
    const id = f.add(1);
    const { stub } = f.client();

    // At the moment the server is asked, the mark has to be there already.
    let markedWhenDeleting: string | null | undefined;
    const original = stub.messageDelete.bind(stub);
    stub.messageDelete = async (range: string) => {
      markedWhenDeleting = f.db.getMessage(id)?.server_removed_at;
      return original(range);
    };

    await f.engine(stub).run();

    expect(markedWhenDeleting).toBeTruthy();
    const records = await readJournal(f.dir);
    expect(records).toContainEqual(expect.objectContaining({ op: 'server-remove', file: '1.eml' }));
  });

  it('takes the mark back when the server refuses', async () => {
    const f = fixture();
    const id = f.add(1);
    const { stub } = f.client();
    stub.messageDelete = async () => false;

    const result = await f.engine(stub).run();

    expect(result.phase).toBe('failed');
    expect(f.db.getMessage(id)?.server_removed_at).toBeNull();
    expect(await readJournal(f.dir)).not.toContainEqual(
      expect.objectContaining({ op: 'server-remove' }),
    );
  });

  it('survives a rebuild of the index from the files', async () => {
    const f = fixture();
    f.add(1);
    f.add(2);
    const { stub } = f.client();
    await f.engine(stub).run();

    // A fresh index, built from nothing but what is on disk.
    const rebuilt = new ArchiveDatabase(join(mkdtempSync(join(tmpdir(), 'ac-rebuilt-')), 'a.db'));
    const base = join(f.dir, '..', '..');
    await new AdoptEngine(f.account, { db: rebuilt, archiveBaseDir: base }).run();

    const folder = rebuilt.listFolders(f.account.id)[0]!;
    const rows = rebuilt.listActiveMessages(folder.id);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.server_removed_at !== null)).toBe(true);
    // Not offered a second time.
    expect(planRemoval(rebuilt, f.account.id).messages).toBe(0);
  });

  it('forgets the mark when a later journal entry says the mail is back', async () => {
    const f = fixture();
    f.add(1);
    const { stub } = f.client();
    await f.engine(stub).run();

    const { appendJournal } = await import('../src/storage/journal.js');
    await appendJournal(f.dir, { op: 'server-return', ts: new Date().toISOString(), file: '1.eml' });

    const rebuilt = new ArchiveDatabase(join(mkdtempSync(join(tmpdir(), 'ac-rebuilt-')), 'a.db'));
    await new AdoptEngine(f.account, { db: rebuilt, archiveBaseDir: join(f.dir, '..', '..') }).run();

    const folder = rebuilt.listFolders(f.account.id)[0]!;
    expect(rebuilt.listActiveMessages(folder.id)[0]!.server_removed_at).toBeNull();
  });
});

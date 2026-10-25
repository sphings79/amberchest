import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultAccountSettings } from '../src/config/schema.js';
import { ArchiveDatabase } from '../src/db/database.js';
import { scanFolder, type KnownMessage } from '../src/imap/client.js';
import { SyncEngine } from '../src/sync/engine.js';
import { discardMessage } from '../src/storage/discard.js';
import type { Account } from '../src/types.js';

/**
 * A backup should not ask a big mailbox for the envelope of every message each
 * time. An envelope cannot change under a UID, so only the new UIDs get one;
 * the rest are read as UIDs and flags, which is enough to see what was
 * deleted and what changed.
 */

function parseRange(range: string): number[] {
  return range.split(',').flatMap((part) => {
    const [a, b] = part.split(':');
    const from = Number(a);
    if (b === undefined) return [from];
    return Array.from({ length: (b === '*' ? 100_000 : Number(b)) - from + 1 }, (_, i) => from + i);
  });
}

function fakeServer(initial: number[]) {
  const state = {
    uids: new Set(initial),
    flags: new Map<number, string[]>(),
    validity: 1n,
  };
  const log: Array<{ kind: 'envelope' | 'flags' | 'source'; uids: number[] }> = [];
  const stub = {
    capabilities: new Set(['IMAP4rev1']),
    get mailbox() {
      const max = Math.max(0, ...state.uids);
      return { exists: state.uids.size, uidNext: max + 1, uidValidity: state.validity };
    },
    async list() {
      return [
        { path: 'INBOX', name: 'INBOX', delimiter: '/', flags: new Set<string>(), specialUse: null, status: undefined },
      ];
    },
    async mailboxOpen() {
      return stub.mailbox;
    },
    async search() {
      return [...state.uids].sort((a, b) => a - b);
    },
    async *fetch(range: string, query: { source?: boolean; envelope?: boolean }) {
      const wanted = new Set(parseRange(range));
      const hits = [...state.uids].filter((uid) => wanted.has(uid)).sort((a, b) => a - b);
      log.push({ kind: query.source ? 'source' : query.envelope ? 'envelope' : 'flags', uids: hits });
      for (const uid of hits) {
        const flags = new Set(state.flags.get(uid) ?? []);
        if (query.source) {
          yield { uid, source: Buffer.from(`Subject: s${uid}\r\n\r\nbody ${uid}`), flags };
        } else if (query.envelope) {
          yield {
            uid,
            flags,
            internalDate: new Date(Date.UTC(2024, 0, 1, 0, 0, uid % 60)),
            size: 40,
            envelope: {
              messageId: `<m${uid}@x>`,
              subject: `s${uid}`,
              from: [{ address: 'a@b.c' }],
              to: [{ address: 'x@y.z' }],
            },
          };
        } else {
          yield { uid, flags };
        }
      }
    },
  };
  const count = (kind: 'envelope' | 'flags' | 'source'): number[] =>
    log.filter((entry) => entry.kind === kind).flatMap((entry) => entry.uids);
  return { state, stub, log, count, reset: () => (log.length = 0) };
}

function fixture(settings: Partial<ReturnType<typeof defaultAccountSettings>> = {}) {
  const base = mkdtempSync(join(tmpdir(), 'ac-incr-'));
  const db = new ArchiveDatabase(join(base, 'archive.db'));
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
    authType: 'password',
    archivePath: null,
    selectedFolders: ['INBOX'],
    settings: { ...defaultAccountSettings(), ...settings },
    attachments: { folders: [] } as never,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as unknown as Account;

  const run = (stub: unknown) =>
    new SyncEngine(account, {
      db,
      archiveBaseDir: join(base, 'archive'),
      connection: {} as never,
      connect: async (_options, fn) => fn(stub as never),
    }).run();
  const folder = () => db.listFolders(account.id)[0]!;
  return { base, db, account, run, folder };
}

const known = (fingerprint: string): KnownMessage => ({
  messageId: '<k@x>',
  subject: 'kept',
  fromAddress: 'a@b.c',
  toAddress: 'x@y.z',
  internalDate: new Date(Date.UTC(2024, 0, 1)),
  size: 40,
  fingerprint,
});

describe('scanFolder with messages the archive already has', () => {
  it('reads envelopes of new UIDs only and the flags of the others', async () => {
    const server = fakeServer([1, 2, 3, 4]);
    server.state.flags.set(2, ['\\Seen']);

    const scanned = await scanFolder(server.stub as never, {
      known: new Map([
        [1, known('fp-1')],
        [2, known('fp-2')],
        [3, known('fp-3')],
      ]),
    });

    expect(server.count('envelope')).toEqual([4]);
    expect(server.count('flags')).toEqual([1, 2, 3]);
    expect(scanned.map((m) => m.uid)).toEqual([1, 2, 3, 4]);
    // The stored fingerprint stands in for the envelope, the flags are fresh.
    expect(scanned[1]).toMatchObject({ uid: 2, fingerprint: 'fp-2', flags: ['\\Seen'] });
  });

  it('does not list a known message the server no longer has', async () => {
    const server = fakeServer([1, 3]);
    const scanned = await scanFolder(server.stub as never, {
      known: new Map([
        [1, known('fp-1')],
        [2, known('fp-2')],
        [3, known('fp-3')],
      ]),
    });
    expect(scanned.map((m) => m.uid)).toEqual([1, 3]);
    expect(server.count('envelope')).toEqual([]);
  });

  it('reads everything as before when nothing is known', async () => {
    const server = fakeServer([1, 2, 3]);
    await scanFolder(server.stub as never, { known: new Map() });
    expect(server.count('envelope')).toEqual([1, 2, 3]);
    expect(server.count('flags')).toEqual([]);
  });
});

describe('a backup that relies on the stored envelopes', () => {
  it('reads the first run in full and the next one only for what is new', async () => {
    const f = fixture();
    const server = fakeServer([1, 2, 3]);

    await f.run(server.stub);
    expect(server.count('envelope')).toEqual([1, 2, 3]);
    expect(f.folder().last_full_scan).not.toBeNull();

    server.reset();
    server.state.uids.add(4);
    const stats = await f.run(server.stub);

    expect(server.count('envelope')).toEqual([4]);
    expect(server.count('flags')).toEqual([1, 2, 3]);
    expect(server.count('source')).toEqual([4]);
    expect(stats.messagesNew).toBe(1);
  });

  it('still sees a message deleted on the server', async () => {
    const f = fixture();
    const server = fakeServer([1, 2, 3]);
    await f.run(server.stub);

    server.reset();
    server.state.uids.delete(2);
    const stats = await f.run(server.stub);

    expect(stats.messagesDeleted).toBe(1);
    expect(server.count('envelope')).toEqual([]);
    expect(f.db.listActiveMessages(f.folder().id).map((row) => row.uid)).toEqual([1, 3]);
  });

  it('still sees a changed flag', async () => {
    const f = fixture();
    const server = fakeServer([1, 2]);
    await f.run(server.stub);

    server.state.flags.set(1, ['\\Seen']);
    const stats = await f.run(server.stub);

    expect(stats.flagsUpdated).toBe(1);
    const row = f.db.listActiveMessages(f.folder().id).find((entry) => entry.uid === 1)!;
    expect(JSON.parse(row.flags)).toEqual(['\\Seen']);
  });

  it('reads the folder in full when the UIDVALIDITY changed, and downloads nothing twice', async () => {
    const f = fixture();
    const server = fakeServer([1, 2, 3]);
    await f.run(server.stub);

    server.reset();
    server.state.validity = 2n;
    const stats = await f.run(server.stub);

    expect(server.count('envelope')).toEqual([1, 2, 3]);
    expect(server.count('source')).toEqual([]);
    expect(stats.messagesNew).toBe(0);
  });

  it('reads the folder in full once a week', async () => {
    const f = fixture();
    const server = fakeServer([1, 2, 3]);
    await f.run(server.stub);

    const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    f.db.updateFolderSyncState(f.folder().id, { lastFullScan: old });
    server.reset();
    await f.run(server.stub);

    expect(server.count('envelope')).toEqual([1, 2, 3]);
    expect(f.folder().last_full_scan).not.toBe(old);
  });

  it('does not read the envelope of a thrown-out message again, nor download it', async () => {
    const f = fixture();
    const server = fakeServer([1, 2, 3]);
    await f.run(server.stub);

    const row = f.db.listActiveMessages(f.folder().id).find((entry) => entry.uid === 2)!;
    await discardMessage(f.db, f.account, f.folder(), row, join(f.base, 'archive'));

    server.reset();
    const stats = await f.run(server.stub);

    expect(server.count('envelope')).toEqual([]);
    expect(server.count('source')).toEqual([]);
    expect(stats.messagesNew).toBe(0);
  });
});

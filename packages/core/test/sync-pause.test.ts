import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultAccountSettings } from '../src/config/schema.js';
import { ArchiveDatabase } from '../src/db/database.js';
import { scanFolder, serverPauseReason } from '../src/imap/client.js';
import { pauseWaitMs, pausedUntil } from '../src/sync/pause.js';
import { SyncEngine } from '../src/sync/engine.js';
import type { Account, SyncProgress } from '../src/types.js';

/**
 * A host that closes the connection in the middle of a run is not a broken
 * host: what came in is kept, the run is paused, and the schedule waits
 * before it tries again.
 */

interface FakeOptions {
  count: number;
  /** Size of every message body, in bytes. */
  bodyBytes?: number;
  /** The connection is lost after this many bodies were handed out. */
  dropAfterBodies?: number;
  /** UIDs already gone, to leave gaps. */
  firstUid?: number;
}

function noConnection(reason?: string): Error {
  return Object.assign(new Error('Connection not available'), {
    code: 'NoConnection',
    ...(reason ? { reason } : {}),
    command: 'UID FETCH',
  });
}

function parseRange(range: string): number[] {
  return range.split(',').flatMap((part) => {
    const [a, b] = part.split(':');
    const from = Number(a);
    if (b === undefined) return [from];
    return Array.from({ length: (b === '*' ? 100_000 : Number(b)) - from + 1 }, (_, i) => from + i);
  });
}

function fakeServer(options: FakeOptions) {
  const first = options.firstUid ?? 1;
  const uids = Array.from({ length: options.count }, (_, i) => first + i);
  const scanRanges: string[] = [];
  let bodies = 0;
  const bodyBytes = options.bodyBytes ?? 200;
  const stub = {
    capabilities: new Set(['IMAP4rev1']),
    mailbox: { exists: uids.length, uidNext: first + options.count, uidValidity: 1n },
    async list() {
      return [
        { path: 'INBOX', name: 'INBOX', delimiter: '/', flags: new Set<string>(), specialUse: null, status: undefined },
      ];
    },
    async mailboxOpen() {
      return stub.mailbox;
    },
    async search() {
      return uids;
    },
    async *fetch(range: string, query: { source?: boolean }) {
      if (!query.source) scanRanges.push(range);
      const wanted = new Set(parseRange(range));
      for (const uid of uids) {
        if (!wanted.has(uid)) continue;
        if (query.source) {
          if (options.dropAfterBodies !== undefined && bodies >= options.dropAfterBodies) {
            throw noConnection('Account exceeded command or bandwidth limits.');
          }
          bodies += 1;
          yield { uid, source: Buffer.alloc(bodyBytes, 'x'), flags: [] };
        } else {
          yield {
            uid,
            flags: new Set<string>(),
            internalDate: new Date(Date.UTC(2024, 0, 1, 0, 0, uid % 60)),
            size: bodyBytes,
            envelope: {
              messageId: `<m${uid}@x>`,
              subject: `s${uid}`,
              from: [{ address: 'a@b.c' }],
              to: [{ address: 'x@y.z' }],
            },
          };
        }
      }
    },
  };
  return { stub, scanRanges };
}

function fixture(settings: Partial<ReturnType<typeof defaultAccountSettings>> = {}) {
  const base = mkdtempSync(join(tmpdir(), 'ac-pause-'));
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

  const run = async (stub: unknown) => {
    const engine = new SyncEngine(account, {
      db,
      archiveBaseDir: join(base, 'archive'),
      connection: {} as never,
      connect: async (_options, fn) => fn(stub as never),
    });
    const phases: SyncProgress['phase'][] = [];
    engine.on('progress', (progress: SyncProgress) => phases.push(progress.phase));
    const result = await engine.run().then(
      (stats) => ({ stats, error: null as Error | null }),
      (error: Error) => ({ stats: null, error }),
    );
    return { ...result, phases };
  };
  return { db, account, run };
}

describe('scanning in blocks', () => {
  it('asks for the UIDs in blocks and gets every message', async () => {
    const { stub, scanRanges } = fakeServer({ count: 2500 });
    const scanned = await scanFolder(stub as never, { blockSize: 1000 });
    expect(scanRanges).toEqual(['1:1000', '1001:2000', '2001:2500']);
    expect(scanned).toHaveLength(2500);
  });

  it('keeps to one command when no block size is given', async () => {
    const { stub, scanRanges } = fakeServer({ count: 2500 });
    await scanFolder(stub as never);
    expect(scanRanges).toEqual(['1:*']);
  });

  it('blocks a search result as well', async () => {
    const { stub, scanRanges } = fakeServer({ count: 25 });
    await scanFolder(stub as never, { since: new Date(0), blockSize: 10 });
    expect(scanRanges).toEqual(['1:10', '11:20', '21:25']);
  });

  it('stops between blocks when cancelled', async () => {
    const { stub, scanRanges } = fakeServer({ count: 2500 });
    let calls = 0;
    const scanned = await scanFolder(stub as never, { blockSize: 1000, shouldCancel: () => ++calls > 1 });
    expect(scanRanges).toEqual(['1:1000']);
    expect(scanned).toHaveLength(1000);
  });
});

describe('when to pause', () => {
  it('pauses for a connection the server closed and for a named limit', () => {
    expect(serverPauseReason(noConnection('Account exceeded command or bandwidth limits.'))).toContain(
      'bandwidth limits',
    );
    expect(serverPauseReason(noConnection())).toBe('Connection not available (during UID FETCH)');
    expect(serverPauseReason(Object.assign(new Error('x'), { responseText: 'Too many connections' }))).not.toBeNull();
  });

  it('fails for everything else', () => {
    expect(serverPauseReason(Object.assign(new Error('x'), { authenticationFailed: true }))).toBeNull();
    expect(serverPauseReason(Object.assign(new Error('x'), { code: 'ENOTFOUND' }))).toBeNull();
  });

  it('waits 6, 12, 24 and at most 48 hours', () => {
    const hours = [0, 1, 2, 3, 4, 9].map((n) => pauseWaitMs(n) / 3_600_000);
    expect(hours).toEqual([0, 6, 12, 24, 48, 48]);
  });
});

describe('a run the server cuts off', () => {
  it('keeps what it downloaded, ends as paused, and makes the schedule wait', async () => {
    const f = fixture();
    const { stub } = fakeServer({ count: 10, dropAfterBodies: 4 });

    const first = await f.run(stub);

    expect(first.error?.message).toBe('Connection not available');
    expect(first.phases.at(-1)).toBe('paused');
    expect(f.db.listActiveMessages(f.db.listFolders(f.account.id)[0]!.id)).toHaveLength(4);
    expect(f.db.pauseState(f.account.id).consecutive).toBe(1);
    expect(pausedUntil(f.db, f.account.id)).not.toBeNull();
  });

  it('counts pauses in a row and starts afresh after a run that got through', async () => {
    const f = fixture();
    await f.run(fakeServer({ count: 10, dropAfterBodies: 2 }).stub);
    await f.run(fakeServer({ count: 10, dropAfterBodies: 2 }).stub);
    expect(f.db.pauseState(f.account.id).consecutive).toBe(2);

    const finished = await f.run(fakeServer({ count: 10 }).stub);
    expect(finished.error).toBeNull();
    expect(f.db.pauseState(f.account.id).consecutive).toBe(0);
    expect(pausedUntil(f.db, f.account.id)).toBeNull();
  });

  it('still fails for a wrong password', async () => {
    const f = fixture();
    const { stub } = fakeServer({ count: 3 });
    stub.list = async () => {
      throw Object.assign(new Error('nope'), { authenticationFailed: true });
    };
    const result = await f.run(stub);
    expect(result.phases.at(-1)).toBe('failed');
    expect(f.db.pauseState(f.account.id).consecutive).toBe(0);
  });
});

describe('the limit per run', () => {
  it('stops cleanly at the limit and the next run carries on', async () => {
    // 600 KB bodies against a limit of 1 MB: two messages make a run.
    const f = fixture({ maxMegabytesPerRun: 1 });
    const server = fakeServer({ count: 5, bodyBytes: 600 * 1024 });

    const first = await f.run(server.stub);
    expect(first.error).toBeNull();
    expect(first.stats?.messagesNew).toBe(2);
    expect(first.stats?.stoppedAtLimit).toBe(true);
    expect(first.phases.at(-1)).toBe('done');

    const second = await f.run(server.stub);
    expect(second.stats?.messagesNew).toBe(2);

    const third = await f.run(server.stub);
    expect(third.stats?.messagesNew).toBe(1);
    expect(third.stats?.stoppedAtLimit).toBeUndefined();
  });

  it('has no limit by default', async () => {
    const f = fixture();
    const result = await f.run(fakeServer({ count: 5, bodyBytes: 600 * 1024 }).stub);
    expect(result.stats?.messagesNew).toBe(5);
  });
});

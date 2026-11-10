import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { AmberChestApp } from '../src/app.js';
import { ArchiveDatabase } from '../src/db/database.js';
import { Scheduler } from '../src/schedule/scheduler.js';
import { AccountPassiveError, passiveWarning, STALE_AFTER_DAYS } from '../src/sync/passive.js';
import type { SyncStats } from '../src/types.js';

/**
 * A passive account is a retired mailbox kept as a local archive. Nothing may
 * open a connection for it, and switching to it must not silently throw away
 * a backup that was missing something.
 */

const STATS = {} as SyncStats;

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'amberchest-passive-'));
}

function dbWithRun(status: 'done' | 'failed' | 'paused' | null): ArchiveDatabase {
  const db = new ArchiveDatabase(join(tempDir(), 'index.db'));
  if (status) {
    db.startRun('run-1', 'a1');
    db.finishRun('run-1', status, STATS, status === 'done' ? undefined : 'boom');
  }
  return db;
}

describe('passiveWarning', () => {
  it('warns when the account was never backed up', () => {
    expect(passiveWarning(dbWithRun(null), 'a1')).toEqual({ reason: 'never' });
  });

  it.each(['failed', 'paused'] as const)('warns when the last run ended %s', (status) => {
    expect(passiveWarning(dbWithRun(status), 'a1')).toEqual({
      reason: 'last-run-not-done',
      status,
      error: 'boom',
    });
  });

  it('stays quiet after a recent clean run', () => {
    expect(passiveWarning(dbWithRun('done'), 'a1')).toBeNull();
  });

  it('warns once the clean run is older than the limit', () => {
    const later = new Date(Date.now() + (STALE_AFTER_DAYS + 1) * 24 * 60 * 60 * 1000);
    expect(passiveWarning(dbWithRun('done'), 'a1', later)).toMatchObject({ reason: 'stale' });
  });
});

describe('a passive account in the app', () => {
  async function setup() {
    const dir = tempDir();
    const app = new AmberChestApp({ configPath: join(dir, 'config.json'), databasePath: join(dir, 'index.db') });
    await app.config.initialize('master-password');
    const added = await app.addAccount({
      name: 'Old mailbox',
      email: 'old@example.invalid',
      host: 'imap.example.invalid',
      port: 993,
      security: 'tls',
      rejectUnauthorized: true,
      username: 'old',
      password: 'secret',
      archivePath: null,
    });
    return { app, id: added.id };
  }

  it('starts out active', async () => {
    const { app, id } = await setup();
    expect(app.requireAccount(id).passive).toBe(false);
  });

  it('refuses to switch while the last backup is missing, unless forced', async () => {
    const { app, id } = await setup();
    const refused = await app.setAccountPassive(id, true);
    expect(refused).toMatchObject({ changed: false, warning: { reason: 'never' } });
    expect(app.requireAccount(id).passive).toBe(false);

    const forced = await app.setAccountPassive(id, true, { force: true });
    expect(forced.changed).toBe(true);
    expect(app.requireAccount(id).passive).toBe(true);
  });

  it('never builds a connection, starts a backup or lists folders', async () => {
    const { app, id } = await setup();
    // Allowed on the account, so that it is the passive state that stops it.
    await app.updateAccount(id, { settings: { allowServerRemoval: true } });
    await app.setAccountPassive(id, true, { force: true });

    await expect(app.connectionFor(app.requireAccount(id))).rejects.toBeInstanceOf(AccountPassiveError);
    await expect(app.startSync(id)).rejects.toBeInstanceOf(AccountPassiveError);
    await expect(app.getFolderTree(id)).rejects.toBeInstanceOf(AccountPassiveError);
    expect(() => app.startVerify(id, { checkServer: true })).toThrow(AccountPassiveError);
    expect(() => app.startAdopt(id, { askServer: true })).toThrow(AccountPassiveError);
    await expect(app.startServerRemoval(id)).rejects.toBeInstanceOf(AccountPassiveError);
  });

  it('keeps the stored password and lets the account go active again without a check', async () => {
    const { app, id } = await setup();
    await app.setAccountPassive(id, true, { force: true });
    expect(app.requireAccount(id).password).toBe('secret');

    const back = await app.setAccountPassive(id, false);
    expect(back).toMatchObject({ changed: true, warning: null });
    expect(app.requireAccount(id).passive).toBe(false);
    await expect(app.connectionFor(app.requireAccount(id))).resolves.toMatchObject({ host: 'imap.example.invalid' });
  });

  it('shows up as passive in the overview and the public account', async () => {
    const { app, id } = await setup();
    await app.setAccountPassive(id, true, { force: true });
    const entry = app.overview().find((candidate) => candidate.account.id === id);
    expect(entry?.account.passive).toBe(true);
  });

  it('is not changed by the generic account update', async () => {
    const { app, id } = await setup();
    await app.updateAccount(id, { name: 'Renamed', passive: true } as never);
    expect(app.requireAccount(id).passive).toBe(false);
  });
});

describe('the scheduler', () => {
  it('skips a passive account and backs up the others', async () => {
    const startSyncAndIndex = vi.fn(async () => undefined);
    const account = (id: string, passive: boolean) => ({
      account: { id, name: id, passive, selectedFolders: ['INBOX'] },
    });
    const app = {
      overview: () => [account('retired', true), account('current', false)],
      pausedUntil: () => null,
      startSyncAndIndex,
    };
    const scheduler = new Scheduler({ app: app as never, expression: '* * * * *' });
    await (scheduler as unknown as { tick: () => Promise<void> }).tick();
    expect(startSyncAndIndex).toHaveBeenCalledTimes(1);
    expect(startSyncAndIndex).toHaveBeenCalledWith('current');
  });
});

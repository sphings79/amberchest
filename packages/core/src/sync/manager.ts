import { EventEmitter } from 'node:events';
import type { ArchiveDatabase } from '../db/database.js';
import type { ImapConnectionOptions } from '../imap/client.js';
import type { Account, SyncProgress } from '../types.js';
import { SyncEngine } from './engine.js';

export interface SyncManagerOptions {
  db: ArchiveDatabase;
  /** Resolves the base archive directory at the time a run starts. */
  archiveBaseDir: () => string;
  /** Resolves the archive key at the time a run starts. */
  encryptionKey?: () => Buffer | null;
  /** Builds the connection, refreshing an OAuth token when it is due. */
  connectionFor?: (account: Account) => Promise<ImapConnectionOptions>;
}

/**
 * Keeps track of the running backups.
 *
 * One run per account at a time; the UI subscribes to `progress` and gets the
 * same objects that are stored as the last known state for late joiners.
 */
export class SyncManager extends EventEmitter {
  private readonly running = new Map<string, SyncEngine>();
  private readonly lastProgress = new Map<string, SyncProgress>();

  constructor(private readonly options: SyncManagerOptions) {
    super();
    this.setMaxListeners(100);
  }

  isRunning(accountId: string): boolean {
    return this.running.has(accountId);
  }

  runningAccounts(): string[] {
    return [...this.running.keys()];
  }

  getProgress(accountId: string): SyncProgress | undefined {
    return this.lastProgress.get(accountId);
  }

  allProgress(): SyncProgress[] {
    return [...this.lastProgress.values()];
  }

  /** Starts a backup and resolves once it finished, failed or was cancelled. */
  async start(account: Account): Promise<SyncProgress | undefined> {
    if (this.running.has(account.id)) {
      throw new Error('A backup is already running for this account');
    }

    const engine = new SyncEngine(account, {
      db: this.options.db,
      archiveBaseDir: this.options.archiveBaseDir(),
      encryptionKey: this.options.encryptionKey?.() ?? null,
      connection: await this.options.connectionFor?.(account),
    });

    engine.on('progress', (progress: SyncProgress) => {
      this.lastProgress.set(account.id, progress);
      this.emit('progress', progress);
    });

    this.running.set(account.id, engine);
    try {
      await engine.run();
    } catch {
      // The failure is already reported through the progress event.
    } finally {
      this.running.delete(account.id);
    }
    return this.lastProgress.get(account.id);
  }

  cancel(accountId: string): boolean {
    const engine = this.running.get(accountId);
    if (!engine) return false;
    engine.cancel();
    return true;
  }
}

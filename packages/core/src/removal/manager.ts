import { EventEmitter } from 'node:events';
import type { ArchiveDatabase } from '../db/database.js';
import type { ImapConnectionOptions } from '../imap/client.js';
import type { Account } from '../types.js';
import {
  RemovalEngine,
  type RemovalOptions,
  type RemovalProgress,
} from './engine.js';

export interface RemovalManagerOptions {
  db: ArchiveDatabase;
  archiveBaseDir: () => string;
  encryptionKey?: () => Buffer | null;
  connectionFor: (account: Account) => Promise<ImapConnectionOptions>;
  /** A backup of the same account and a removal must not overlap. */
  isSyncing: (accountId: string) => boolean;
}

/**
 * One removal per account at a time, and never alongside that account's backup.
 *
 * A backup reads UIDs while a removal makes them disappear; running both would
 * have the backup read a folder that changes under it.
 */
export class RemovalManager extends EventEmitter {
  private readonly running = new Map<string, RemovalEngine>();
  private readonly lastProgress = new Map<string, RemovalProgress>();

  constructor(private readonly options: RemovalManagerOptions) {
    super();
    this.setMaxListeners(100);
  }

  isRunning(accountId: string): boolean {
    return this.running.has(accountId);
  }

  getProgress(accountId: string): RemovalProgress | undefined {
    return this.lastProgress.get(accountId);
  }

  async start(account: Account, request: RemovalOptions = {}): Promise<RemovalProgress> {
    if (this.running.has(account.id)) {
      throw new Error('A removal is already running for this account');
    }
    if (this.options.isSyncing(account.id)) {
      throw new Error('A backup is running for this account; wait for it to finish');
    }
    if (!account.settings.allowServerRemoval) {
      throw new Error('Removing mail from the server is not enabled for this account');
    }

    const engine = new RemovalEngine(
      account,
      {
        db: this.options.db,
        archiveBaseDir: this.options.archiveBaseDir(),
        encryptionKey: this.options.encryptionKey?.() ?? null,
        connection: await this.options.connectionFor(account),
      },
      request,
    );
    engine.on('progress', (progress: RemovalProgress) => {
      this.lastProgress.set(account.id, progress);
      this.emit('progress', progress);
    });

    this.running.set(account.id, engine);
    try {
      return await engine.run();
    } finally {
      this.running.delete(account.id);
    }
  }

  cancel(accountId: string): boolean {
    const engine = this.running.get(accountId);
    if (!engine) return false;
    engine.cancel();
    return true;
  }
}

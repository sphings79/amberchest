import { EventEmitter } from 'node:events';
import type { ArchiveDatabase } from '../db/database.js';
import type { Account } from '../types.js';
import { DedupeEngine, type DedupeProgress } from './engine.js';

export interface DedupeManagerOptions {
  db: ArchiveDatabase;
  archiveBaseDir: () => string;
  encryptionKey?: () => Buffer | null;
  /** A backup, a check or a removal on the same account must not overlap. */
  isBusy: (accountId: string) => boolean;
}

/** One merge per account at a time, and never alongside other work on its files. */
export class DedupeManager extends EventEmitter {
  private readonly running = new Map<string, DedupeEngine>();
  private readonly lastProgress = new Map<string, DedupeProgress>();

  constructor(private readonly options: DedupeManagerOptions) {
    super();
    this.setMaxListeners(100);
  }

  isRunning(accountId: string): boolean {
    return this.running.has(accountId);
  }

  getProgress(accountId: string): DedupeProgress | undefined {
    return this.lastProgress.get(accountId);
  }

  async start(account: Account): Promise<DedupeProgress> {
    if (this.running.has(account.id)) {
      throw new Error('Merging duplicates is already running for this account');
    }
    if (this.options.isBusy(account.id)) {
      throw new Error('A backup, a check or a removal is running for this account; wait for it to finish');
    }

    const engine = new DedupeEngine(account, {
      db: this.options.db,
      archiveBaseDir: this.options.archiveBaseDir(),
      encryptionKey: this.options.encryptionKey?.() ?? null,
    });
    engine.on('progress', (progress: DedupeProgress) => {
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

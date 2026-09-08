import { EventEmitter } from 'node:events';
import type { ArchiveDatabase } from '../db/database.js';
import type { Account } from '../types.js';
import { SearchIndexEngine, type IndexProgress } from './indexer.js';

export interface IndexManagerOptions {
  db: ArchiveDatabase;
  archiveBaseDir: () => string;
  /** Resolves the archive key at the time a run starts. */
  encryptionKey?: () => Buffer | null;
}

export interface IndexOptions {
  indexAttachments: boolean;
  maxAttachmentBytes: number;
}

/** Runs one indexing pass per account at a time. */
export class SearchIndexManager extends EventEmitter {
  private readonly running = new Map<string, SearchIndexEngine>();
  private readonly lastProgress = new Map<string, IndexProgress>();

  constructor(private readonly options: IndexManagerOptions) {
    super();
    this.setMaxListeners(100);
  }

  isRunning(accountId: string): boolean {
    return this.running.has(accountId);
  }

  getProgress(accountId: string): IndexProgress | undefined {
    return this.lastProgress.get(accountId);
  }

  allProgress(): IndexProgress[] {
    return [...this.lastProgress.values()];
  }

  async start(account: Account, options: IndexOptions): Promise<IndexProgress | undefined> {
    if (this.running.has(account.id)) throw new Error('Indexing is already running for this account');

    const engine = new SearchIndexEngine(account, {
      db: this.options.db,
      archiveBaseDir: this.options.archiveBaseDir(),
      encryptionKey: this.options.encryptionKey?.() ?? null,
      indexAttachments: options.indexAttachments,
      maxAttachmentBytes: options.maxAttachmentBytes,
    });

    engine.on('progress', (progress: IndexProgress) => {
      this.lastProgress.set(account.id, progress);
      this.emit('progress', progress);
    });

    this.running.set(account.id, engine);
    try {
      await engine.run();
    } catch {
      // Reported through the progress event.
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

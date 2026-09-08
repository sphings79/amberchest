import { EventEmitter } from 'node:events';
import type { ArchiveDatabase } from '../db/database.js';
import type { Account, ExportProgress } from '../types.js';
import { AttachmentExportEngine } from './engine.js';

export interface ExportManagerOptions {
  db: ArchiveDatabase;
  archiveBaseDir: () => string;
  /** Resolves the archive key at the time a run starts. */
  encryptionKey?: () => Buffer | null;
}

/**
 * Runs one attachment export per account at a time and keeps the last known
 * progress around, so a client that connects mid-run still sees where it is.
 */
export class AttachmentExportManager extends EventEmitter {
  private readonly running = new Map<string, AttachmentExportEngine>();
  private readonly lastProgress = new Map<string, ExportProgress>();

  constructor(private readonly options: ExportManagerOptions) {
    super();
    this.setMaxListeners(100);
  }

  isRunning(accountId: string): boolean {
    return this.running.has(accountId);
  }

  getProgress(accountId: string): ExportProgress | undefined {
    return this.lastProgress.get(accountId);
  }

  allProgress(): ExportProgress[] {
    return [...this.lastProgress.values()];
  }

  async start(account: Account): Promise<ExportProgress | undefined> {
    if (this.running.has(account.id)) {
      throw new Error('An attachment export is already running for this account');
    }

    const engine = new AttachmentExportEngine(account, {
      db: this.options.db,
      archiveBaseDir: this.options.archiveBaseDir(),
      encryptionKey: this.options.encryptionKey?.() ?? null,
    });

    engine.on('progress', (progress: ExportProgress) => {
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

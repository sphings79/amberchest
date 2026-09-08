import { EventEmitter } from 'node:events';
import type { ArchiveDatabase } from '../db/database.js';
import type { ImapConnectionOptions } from '../imap/client.js';
import type { Account } from '../types.js';
import { VerifyEngine, type VerifyOptions, type VerifyProgress } from './engine.js';

export interface VerifyManagerOptions {
  db: ArchiveDatabase;
  archiveBaseDir: () => string;
  encryptionKey?: () => Buffer | null;
  /** Builds a connection when the server is to be asked as well. */
  connectionFor?: (account: Account) => Promise<ImapConnectionOptions>;
}

/** One verification per account at a time, with the result kept for later. */
export class VerifyManager extends EventEmitter {
  private readonly running = new Map<string, VerifyEngine>();
  private readonly lastProgress = new Map<string, VerifyProgress>();

  constructor(private readonly options: VerifyManagerOptions) {
    super();
    this.setMaxListeners(100);
  }

  isRunning(accountId: string): boolean {
    return this.running.has(accountId);
  }

  getProgress(accountId: string): VerifyProgress | undefined {
    return this.lastProgress.get(accountId);
  }

  /** The stored result of the last run, which survives a restart. */
  lastRun(accountId: string): VerifyProgress | null {
    const live = this.lastProgress.get(accountId);
    if (live) return live;

    const row = this.options.db.lastVerifyRun(accountId);
    if (!row) return null;
    return {
      runId: String(row.id),
      accountId,
      phase: String(row.status) as VerifyProgress['phase'],
      currentFolder: null,
      stats: JSON.parse(String(row.stats)) as VerifyProgress['stats'],
      findings: JSON.parse(String(row.findings)) as VerifyProgress['findings'],
      startedAt: String(row.started_at),
      ...(row.error ? { error: String(row.error) } : {}),
    };
  }

  async start(
    account: Account,
    options: { checkServer?: boolean; includeDeleted?: boolean } = {},
  ): Promise<VerifyProgress> {
    if (this.running.has(account.id)) {
      throw new Error('A verification is already running for this account');
    }

    const engineOptions: VerifyOptions = {
      db: this.options.db,
      archiveBaseDir: this.options.archiveBaseDir(),
      encryptionKey: this.options.encryptionKey?.() ?? null,
      includeDeleted: options.includeDeleted ?? false,
      ...(options.checkServer && this.options.connectionFor
        ? { connection: await this.options.connectionFor(account) }
        : {}),
    };

    const engine = new VerifyEngine(account, engineOptions);
    engine.on('progress', (progress: VerifyProgress) => {
      this.lastProgress.set(account.id, progress);
      this.emit('progress', progress);
    });

    this.running.set(account.id, engine);
    try {
      const result = await engine.run();
      this.options.db.recordVerifyRun({
        id: result.runId,
        accountId: account.id,
        startedAt: result.startedAt,
        finishedAt: new Date().toISOString(),
        status: result.phase,
        stats: result.stats,
        findings: result.findings,
        error: result.error ?? null,
      });
      return result;
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

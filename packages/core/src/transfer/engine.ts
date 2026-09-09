import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { ArchiveLayout } from '../storage/archive.js';
import type { Account } from '../types.js';
import { logger } from '../util/logger.js';

export class TransferCancelledError extends Error {
  constructor() {
    super('Transfer cancelled');
    this.name = 'TransferCancelledError';
  }
}

export type TransferPhase =
  | 'listing'
  | 'sending'
  | 'adopting'
  | 'done'
  | 'cancelled'
  | 'failed';

export interface TransferStats {
  filesTotal: number;
  filesSent: number;
  /** Already on the other side with the same size. */
  filesSkipped: number;
  filesFailed: number;
  bytesSent: number;
  bytesTotal: number;
}

export interface TransferProgress {
  runId: string;
  accountId: string;
  phase: TransferPhase;
  currentFile: string | null;
  stats: TransferStats;
  startedAt: string;
  error?: string;
  /** What the other side made of the files, once it has adopted them. */
  adopted?: Record<string, number>;
}

export interface TransferTarget {
  /** Base address of the other instance, without a trailing slash. */
  url: string;
  token: string;
  /** The account over there the archive belongs to. */
  accountId: string;
}

export interface TransferOptions {
  archiveBaseDir: string;
  target: TransferTarget;
  /** Send the _deleted tree as well. */
  includeDeleted?: boolean;
}

interface RemoteFile {
  path: string;
  size: number;
}

/**
 * Sends an archive to another instance.
 *
 * The way from the desktop app into a container: the files travel, the index
 * does not - the other side rebuilds it from the journals, which is what makes
 * an interrupted transfer harmless. Every file is compared by size first, so
 * running it again only carries what is still missing.
 *
 * Nothing is deleted here afterwards. Removing the local copy is a decision
 * for a person, taken once the other side has been looked at.
 */
export class TransferEngine extends EventEmitter {
  readonly runId = randomUUID();

  private cancelled = false;
  private currentFile: string | null = null;
  private readonly startedAt = new Date().toISOString();
  private readonly stats: TransferStats = {
    filesTotal: 0,
    filesSent: 0,
    filesSkipped: 0,
    filesFailed: 0,
    bytesSent: 0,
    bytesTotal: 0,
  };

  constructor(
    private readonly account: Account,
    private readonly options: TransferOptions,
  ) {
    super();
  }

  cancel(): void {
    this.cancelled = true;
  }

  private emitProgress(phase: TransferPhase, extra: Partial<TransferProgress> = {}): void {
    this.emit('progress', {
      runId: this.runId,
      accountId: this.account.id,
      phase,
      currentFile: this.currentFile,
      stats: { ...this.stats },
      startedAt: this.startedAt,
      ...extra,
    } satisfies TransferProgress);
  }

  private get base(): string {
    return this.options.target.url.replace(/\/+$/, '');
  }

  private get headers(): Record<string, string> {
    return this.options.target.token
      ? { authorization: `Bearer ${this.options.target.token}` }
      : {};
  }

  async run(): Promise<TransferProgress> {
    const layout = new ArchiveLayout(this.options.archiveBaseDir);
    const accountDir = layout.accountDir(this.account);
    logger.info(`Transferring the archive of ${this.account.name} to ${this.base}`);
    this.emitProgress('listing');

    try {
      const [local, remote] = await Promise.all([
        this.localFiles(accountDir),
        this.remoteFiles(),
      ]);

      this.stats.filesTotal = local.length;
      this.stats.bytesTotal = local.reduce((sum, file) => sum + file.size, 0);
      this.emitProgress('sending');

      for (const file of local) {
        if (this.cancelled) throw new TransferCancelledError();
        this.currentFile = file.path;

        // Same name and same size on the other side: nothing to do. Enough to
        // make a second run cheap without hashing gigabytes.
        if (remote.get(file.path) === file.size) {
          this.stats.filesSkipped += 1;
          continue;
        }

        try {
          await this.sendFile(accountDir, file.path);
          this.stats.filesSent += 1;
          this.stats.bytesSent += file.size;
        } catch (error) {
          this.stats.filesFailed += 1;
          logger.warn(`Could not send ${file.path}: ${(error as Error).message}`);
        }

        if ((this.stats.filesSent + this.stats.filesSkipped) % 25 === 0) {
          this.emitProgress('sending');
        }
      }

      this.currentFile = null;
      this.emitProgress('adopting');
      const adopted = await this.adoptOnTarget();

      this.emitProgress('done', { adopted });
      logger.info(
        `Transfer finished: ${this.stats.filesSent} sent, ${this.stats.filesSkipped} already there, ` +
          `${this.stats.filesFailed} failed`,
      );
      return {
        runId: this.runId,
        accountId: this.account.id,
        phase: 'done',
        currentFile: null,
        stats: { ...this.stats },
        startedAt: this.startedAt,
        adopted,
      };
    } catch (error) {
      if (error instanceof TransferCancelledError) {
        this.emitProgress('cancelled');
        return {
          runId: this.runId,
          accountId: this.account.id,
          phase: 'cancelled',
          currentFile: this.currentFile,
          stats: { ...this.stats },
          startedAt: this.startedAt,
        };
      }
      const message = (error as Error).message;
      this.emitProgress('failed', { error: message });
      logger.error(`Transfer failed: ${message}`);
      return {
        runId: this.runId,
        accountId: this.account.id,
        phase: 'failed',
        currentFile: this.currentFile,
        stats: { ...this.stats },
        startedAt: this.startedAt,
        error: message,
      };
    }
  }

  /** Every message file and journal below the account directory. */
  private async localFiles(accountDir: string): Promise<RemoteFile[]> {
    const found: RemoteFile[] = [];

    const walk = async (directory: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        const full = join(directory, entry.name);
        if (entry.isDirectory()) {
          if (!this.options.includeDeleted && entry.name === '_deleted') continue;
          await walk(full);
          continue;
        }
        if (!entry.isFile()) continue;
        if (!entry.name.endsWith('.eml') && !entry.name.startsWith('.amberchest')) continue;

        const info = await stat(full).catch(() => null);
        if (info) found.push({ path: relative(accountDir, full).split(sep).join('/'), size: info.size });
      }
    };

    await walk(accountDir);
    return found;
  }

  /** What the other side already holds, by path and size. */
  private async remoteFiles(): Promise<Map<string, number>> {
    const response = await fetch(
      `${this.base}/api/accounts/${this.options.target.accountId}/archive/manifest`,
      { headers: this.headers, signal: AbortSignal.timeout(60_000) },
    );
    if (!response.ok) {
      throw new Error(`The other side answered with HTTP ${response.status} to the file list`);
    }
    const payload = (await response.json()) as { files: RemoteFile[] };
    return new Map(payload.files.map((file) => [file.path, file.size]));
  }

  private async sendFile(accountDir: string, path: string): Promise<void> {
    const body = await readFile(join(accountDir, ...path.split('/')));
    const url = new URL(
      `${this.base}/api/accounts/${this.options.target.accountId}/archive/file`,
    );
    url.searchParams.set('path', path);

    const response = await fetch(url, {
      method: 'PUT',
      headers: { ...this.headers, 'content-type': 'application/octet-stream' },
      body: new Uint8Array(body),
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  }

  /** Asks the other side to build its index from what just arrived. */
  private async adoptOnTarget(): Promise<Record<string, number>> {
    const response = await fetch(
      `${this.base}/api/accounts/${this.options.target.accountId}/adopt`,
      {
        method: 'POST',
        headers: { ...this.headers, 'content-type': 'application/json' },
        body: JSON.stringify({ includeDeleted: this.options.includeDeleted ?? false }),
        signal: AbortSignal.timeout(3_600_000),
      },
    );
    if (!response.ok) {
      throw new Error(`The other side answered with HTTP ${response.status} to the adoption`);
    }
    const payload = (await response.json()) as { stats?: Record<string, number> };
    return payload.stats ?? {};
  }
}

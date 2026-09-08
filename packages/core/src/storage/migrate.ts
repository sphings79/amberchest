import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { readFile, readdir, rename, stat, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from '../util/logger.js';
import { decryptFile, encryptFile, isEncrypted } from './encryption.js';

export class MigrationCancelledError extends Error {
  constructor() {
    super('Migration cancelled');
    this.name = 'MigrationCancelledError';
  }
}

export interface MigrationStats {
  filesTotal: number;
  filesDone: number;
  filesChanged: number;
  /** Already in the desired state. */
  filesSkipped: number;
  filesFailed: number;
  bytesProcessed: number;
}

export type MigrationPhase = 'scanning' | 'converting' | 'done' | 'cancelled' | 'failed';

export interface MigrationProgress {
  runId: string;
  direction: 'encrypt' | 'decrypt';
  phase: MigrationPhase;
  currentFile: string | null;
  stats: MigrationStats;
  startedAt: string;
  error?: string;
}

/**
 * Converts an existing archive between plain and encrypted.
 *
 * Switching the setting only affects newly downloaded mail, which would leave
 * an archive in two halves. This walks the files on disk and converts them, so
 * "encrypt my archive" means the whole thing.
 *
 * Every file is written to a temporary name and then renamed over the original,
 * so an interrupted run leaves either the old or the new file behind, never a
 * half written one. The modification time is restored because it carries the
 * message date.
 */
export class EncryptionMigrationEngine extends EventEmitter {
  readonly runId = randomUUID();

  private cancelled = false;
  private readonly stats: MigrationStats = {
    filesTotal: 0,
    filesDone: 0,
    filesChanged: 0,
    filesSkipped: 0,
    filesFailed: 0,
    bytesProcessed: 0,
  };
  private readonly startedAt = new Date().toISOString();
  private currentFile: string | null = null;

  constructor(
    private readonly options: {
      /** Directories to walk; usually one per account. */
      directories: string[];
      key: Buffer;
      direction: 'encrypt' | 'decrypt';
    },
  ) {
    super();
  }

  cancel(): void {
    this.cancelled = true;
  }

  private emitProgress(phase: MigrationPhase, error?: string): void {
    this.emit('progress', {
      runId: this.runId,
      direction: this.options.direction,
      phase,
      currentFile: this.currentFile,
      stats: { ...this.stats },
      startedAt: this.startedAt,
      ...(error ? { error } : {}),
    } satisfies MigrationProgress);
  }

  async run(): Promise<MigrationStats> {
    this.emitProgress('scanning');
    logger.info(
      `Archive ${this.options.direction === 'encrypt' ? 'encryption' : 'decryption'} started`,
    );

    try {
      // A Set, because an account directory can sit inside the base directory
      // and would otherwise be walked twice.
      const seen = new Set<string>();
      for (const directory of this.options.directories) await collectEml(directory, seen);
      const files = [...seen];
      this.stats.filesTotal = files.length;
      this.emitProgress('converting');

      for (const file of files) {
        if (this.cancelled) throw new MigrationCancelledError();
        await this.convert(file);
        this.stats.filesDone += 1;
        if (this.stats.filesDone % 25 === 0) this.emitProgress('converting');
      }

      this.emitProgress('done');
      logger.info(
        `Archive migration finished: ${this.stats.filesChanged} converted, ${this.stats.filesSkipped} already in place`,
      );
      return this.stats;
    } catch (error) {
      if (error instanceof MigrationCancelledError) {
        this.emitProgress('cancelled');
        logger.warn(
          `Archive migration cancelled after ${this.stats.filesChanged} file(s); the rest keeps its previous form`,
        );
        return this.stats;
      }
      const message = (error as Error).message;
      this.emitProgress('failed', message);
      logger.error(`Archive migration failed: ${message}`);
      throw error;
    }
  }

  private async convert(path: string): Promise<void> {
    this.currentFile = path;

    try {
      const buffer = await readFile(path);
      const encrypted = isEncrypted(buffer);

      // Nothing to do when the file is already the way it should be.
      if ((this.options.direction === 'encrypt') === encrypted) {
        this.stats.filesSkipped += 1;
        return;
      }

      const converted =
        this.options.direction === 'encrypt'
          ? encryptFile(buffer, this.options.key)
          : decryptFile(buffer, this.options.key);

      const info = await stat(path);
      const temporary = `${path}.converting`;
      await writeFile(temporary, converted);
      await rename(temporary, path);

      // The modification time carries the message date; put it back.
      try {
        await utimes(path, info.atime, info.mtime);
      } catch {
        // Not fatal on network file systems.
      }

      this.stats.filesChanged += 1;
      this.stats.bytesProcessed += buffer.length;
    } catch (error) {
      this.stats.filesFailed += 1;
      logger.warn(`Cannot convert ${path}: ${(error as Error).message}`);
    }
  }
}

/** Collects every .eml below a directory, including the _deleted tree. */
async function collectEml(directory: string, into: Set<string>): Promise<void> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await collectEml(path, into);
    else if (entry.isFile() && entry.name.endsWith('.eml')) into.add(path);
  }
}

/** Runs one migration at a time; two at once would fight over the same files. */
export class EncryptionMigrationManager extends EventEmitter {
  private current: EncryptionMigrationEngine | null = null;
  private lastProgress: MigrationProgress | null = null;

  get isRunning(): boolean {
    return this.current !== null;
  }

  get progress(): MigrationProgress | null {
    return this.lastProgress;
  }

  async start(options: {
    directories: string[];
    key: Buffer;
    direction: 'encrypt' | 'decrypt';
  }): Promise<MigrationProgress | null> {
    if (this.current) throw new Error('A migration is already running');

    const engine = new EncryptionMigrationEngine(options);
    engine.on('progress', (progress: MigrationProgress) => {
      this.lastProgress = progress;
      this.emit('progress', progress);
    });

    this.current = engine;
    try {
      await engine.run();
    } catch {
      // Reported through the progress event.
    } finally {
      this.current = null;
    }
    return this.lastProgress;
  }

  cancel(): boolean {
    if (!this.current) return false;
    this.current.cancel();
    return true;
  }
}

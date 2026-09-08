import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import type { ArchiveDatabase } from '../db/database.js';
import { listRemoteFolders, withConnection, type ImapConnectionOptions } from '../imap/client.js';
import { ArchiveLayout } from '../storage/archive.js';
import { openMessageFile } from '../storage/encryption.js';
import type { Account } from '../types.js';
import { logger } from '../util/logger.js';

export class VerifyCancelledError extends Error {
  constructor() {
    super('Verification cancelled');
    this.name = 'VerifyCancelledError';
  }
}

export type VerifyPhase =
  | 'scanning'
  | 'checking'
  | 'orphans'
  | 'server'
  | 'done'
  | 'cancelled'
  | 'failed';

export type FindingKind = 'missing' | 'unreadable' | 'changed' | 'orphan' | 'folder-differs';

export interface Finding {
  kind: FindingKind;
  folder: string;
  /** Path relative to the account directory, or the folder for a count. */
  path: string;
  /**
   * What exactly is wrong, as a key the interface translates.
   *
   * A finished sentence here would reach a German user in English, so only the
   * key and its values travel.
   */
  detail: string;
  detailParams?: Record<string, string | number>;
}

export interface VerifyStats {
  messagesTotal: number;
  messagesChecked: number;
  /** The row is there, the file is not. */
  missing: number;
  /** The file cannot be read or decrypted. */
  unreadable: number;
  /** The file no longer matches what came off the server. */
  changed: number;
  /** A file on disk that no row points at. */
  orphans: number;
  /** Checksums an older version had not written yet. */
  hashesAdded: number;
  /** Rows whose bytes live with another message; checked there. */
  linked: number;
  bytesChecked: number;
  /** Only when the server was asked as well. */
  foldersCompared: number;
  foldersDiffering: number;
  serverMessages: number;
  localMessages: number;
}

export interface VerifyProgress {
  runId: string;
  accountId: string;
  phase: VerifyPhase;
  currentFolder: string | null;
  stats: VerifyStats;
  findings: Finding[];
  startedAt: string;
  error?: string;
}

export interface VerifyOptions {
  db: ArchiveDatabase;
  archiveBaseDir: string;
  /** Needed to read an encrypted archive. */
  encryptionKey?: Buffer | null;
  /** Also ask the server how many messages it has per folder. */
  connection?: ImapConnectionOptions | undefined;
  /** Also check what sits in the _deleted tree. */
  includeDeleted?: boolean;
}

/** More than this and the report says "and so on" instead of filling up. */
const MAX_FINDINGS = 500;

/**
 * Checks that the archive still is what it was.
 *
 * A backup nobody ever verifies is a hope, not a backup. This reads every
 * message file, compares it with the checksum taken when it was downloaded,
 * and looks for files that no longer belong to anything. On request it also
 * asks the server how many messages each folder holds, which answers the
 * question one actually has: is anything missing?
 *
 * Nothing is written to the archive, and nothing is deleted. The only change
 * is a checksum filled in for messages archived before this existed.
 */
export class VerifyEngine extends EventEmitter {
  readonly runId = randomUUID();

  private cancelled = false;
  private currentFolder: string | null = null;
  private readonly findings: Finding[] = [];
  private readonly startedAt = new Date().toISOString();
  private readonly stats: VerifyStats = {
    messagesTotal: 0,
    messagesChecked: 0,
    missing: 0,
    unreadable: 0,
    changed: 0,
    orphans: 0,
    hashesAdded: 0,
    linked: 0,
    bytesChecked: 0,
    foldersCompared: 0,
    foldersDiffering: 0,
    serverMessages: 0,
    localMessages: 0,
  };

  constructor(
    private readonly account: Account,
    private readonly options: VerifyOptions,
  ) {
    super();
  }

  cancel(): void {
    this.cancelled = true;
  }

  private emitProgress(phase: VerifyPhase, error?: string): void {
    this.emit('progress', {
      runId: this.runId,
      accountId: this.account.id,
      phase,
      currentFolder: this.currentFolder,
      stats: { ...this.stats },
      findings: [...this.findings],
      startedAt: this.startedAt,
      ...(error ? { error } : {}),
    } satisfies VerifyProgress);
  }

  private note(finding: Finding): void {
    if (this.findings.length < MAX_FINDINGS) this.findings.push(finding);
  }

  async run(): Promise<VerifyProgress> {
    logger.info(`Verifying the archive of ${this.account.name}`);
    this.emitProgress('scanning');

    try {
      const layout = new ArchiveLayout(this.options.archiveBaseDir);
      const accountDir = layout.accountDir(this.account);
      const rows = this.options.db.listMessagesForVerify(
        this.account.id,
        this.options.includeDeleted ?? false,
      );
      this.stats.messagesTotal = rows.length;
      this.emitProgress('checking');

      const expected = new Set<string>();

      for (const row of rows) {
        if (this.cancelled) throw new VerifyCancelledError();
        this.currentFolder = row.folder_path;

        // A message stored once but sitting in several folders is checked with
        // the folder that owns the file, not here.
        if (row.linked_to) {
          this.stats.linked += 1;
          continue;
        }

        const relativePath =
          row.state === 'active'
            ? join(row.local_path, row.file_name)
            : join('_deleted', row.local_path, row.file_name);
        expected.add(relativePath);
        await this.checkOne(join(accountDir, relativePath), relativePath, row);

        this.stats.messagesChecked += 1;
        if (this.stats.messagesChecked % 200 === 0) this.emitProgress('checking');
      }

      this.currentFolder = null;
      this.emitProgress('orphans');
      await this.findOrphans(accountDir, expected);

      if (this.options.connection) {
        this.emitProgress('server');
        await this.compareWithServer();
      }

      this.emitProgress('done');
      logger.info(
        `Verification of ${this.account.name} finished: ${this.stats.messagesChecked} checked, ` +
          `${this.stats.missing} missing, ${this.stats.changed} changed, ${this.stats.orphans} orphaned`,
      );
      return this.progress('done');
    } catch (error) {
      if (error instanceof VerifyCancelledError) {
        this.emitProgress('cancelled');
        return this.progress('cancelled');
      }
      const message = (error as Error).message;
      this.emitProgress('failed', message);
      logger.error(`Verification of ${this.account.name} failed: ${message}`);
      return this.progress('failed', message);
    }
  }

  private progress(phase: VerifyPhase, error?: string): VerifyProgress {
    return {
      runId: this.runId,
      accountId: this.account.id,
      phase,
      currentFolder: this.currentFolder,
      stats: { ...this.stats },
      findings: [...this.findings],
      startedAt: this.startedAt,
      ...(error ? { error } : {}),
    };
  }

  private async checkOne(
    path: string,
    relativePath: string,
    row: { id: number; folder_path: string; sha256: string | null; size: number },
  ): Promise<void> {
    let raw: Buffer;
    try {
      raw = await readFile(path);
    } catch {
      this.stats.missing += 1;
      this.note({ kind: 'missing', folder: row.folder_path, path: relativePath, detail: 'gone' });
      return;
    }

    let plain: Buffer;
    try {
      plain = openMessageFile(raw, this.options.encryptionKey ?? null);
    } catch (error) {
      this.stats.unreadable += 1;
      this.note({
        kind: 'unreadable',
        folder: row.folder_path,
        path: relativePath,
        detail: 'unreadable',
        detailParams: { error: (error as Error).message },
      });
      return;
    }

    this.stats.bytesChecked += plain.length;
    const hash = createHash('sha256').update(plain).digest('hex');

    if (!row.sha256) {
      // Archived before checksums existed: take this one as the baseline.
      this.options.db.setMessageHash(row.id, hash);
      this.stats.hashesAdded += 1;
      return;
    }

    if (hash !== row.sha256) {
      this.stats.changed += 1;
      this.note({
        kind: 'changed',
        folder: row.folder_path,
        path: relativePath,
        detail: 'hashMismatch',
        detailParams: { expected: row.sha256.slice(0, 12), found: hash.slice(0, 12) },
      });
    }
  }

  /** Message files that no row points at any more. */
  private async findOrphans(accountDir: string, expected: Set<string>): Promise<void> {
    const walk = async (directory: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (this.cancelled) throw new VerifyCancelledError();
        const full = join(directory, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
          continue;
        }
        if (!entry.name.endsWith('.eml')) continue;

        const relativePath = relative(accountDir, full);
        // Without the deleted tree in the run, its files are not orphans.
        if (!this.options.includeDeleted && relativePath.split(sep)[0] === '_deleted') continue;
        if (expected.has(relativePath)) continue;

        this.stats.orphans += 1;
        const info = await stat(full).catch(() => null);
        this.note({
          kind: 'orphan',
          folder: relativePath.split(sep).slice(0, -1).join('/'),
          path: relativePath,
          detail: 'notIndexed',
          detailParams: { bytes: info?.size ?? 0 },
        });
      }
    };

    await walk(accountDir);
  }

  /** Asks the server how many messages each folder holds. */
  private async compareWithServer(): Promise<void> {
    const connection = this.options.connection;
    if (!connection) return;

    const local = this.options.db.countActiveByFolder(this.account.id);
    // withCounts costs one STATUS per folder, which is exactly the number the
    // comparison is about.
    const remote = await withConnection(connection, (client) =>
      listRemoteFolders(client, { withCounts: true }),
    );

    for (const folder of remote) {
      if (folder.noSelect) continue;
      // Only folders that are actually being archived can be compared.
      if (!this.account.selectedFolders.includes(folder.path)) continue;

      const here = local.get(folder.path) ?? 0;
      const there = folder.messageCount ?? 0;
      this.stats.foldersCompared += 1;
      this.stats.serverMessages += there;
      this.stats.localMessages += here;

      if (there === here) continue;

      // An account that keeps what the server deleted is meant to hold more
      // than the server does. Reporting that every time would train the user
      // to ignore the report.
      const expected = there < here && this.account.settings.deletedHandling === 'keep';
      if (expected) continue;

      this.stats.foldersDiffering += 1;
      this.note({
        kind: 'folder-differs',
        folder: folder.path,
        path: folder.path,
        detail: there > here ? 'behind' : 'ahead',
        detailParams: { count: Math.abs(there - here) },
      });
    }
  }
}

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import type { ArchiveDatabase, DuplicateCandidate } from '../db/database.js';
import { ArchiveLayout, purgeMessageFile, readArchiveFile, recordLink } from '../storage/archive.js';
import { appendJournal } from '../storage/journal.js';
import type { Account } from '../types.js';
import { sha256 } from '../util/hash.js';
import { logger } from '../util/logger.js';

export class DedupeCancelledError extends Error {
  constructor() {
    super('Merging duplicates cancelled');
    this.name = 'DedupeCancelledError';
  }
}

export type DedupePhase = 'merging' | 'done' | 'cancelled' | 'failed';

export interface DedupeStats {
  /** Copies that can be turned into a link to another folder's file. */
  candidates: number;
  merged: number;
  bytesFreed: number;
  /** The same message, but a file's checksum is missing; "Check archive" adds it. */
  noChecksum: number;
  /** Same fingerprint, different bytes: left alone. */
  differing: number;
  /** A file could not be read or no longer matches its checksum: left alone. */
  notVerified: number;
  failed: number;
}

export interface DedupeProgress {
  runId: string;
  accountId: string;
  phase: DedupePhase;
  currentFolder: string | null;
  stats: DedupeStats;
  startedAt: string;
  error?: string;
}

export interface DedupePlan {
  messages: number;
  bytes: number;
  noChecksum: number;
  differing: number;
  folders: Array<{ path: string; messages: number; bytes: number }>;
}

interface DuplicateGroup {
  owner: DuplicateCandidate;
  copies: DuplicateCandidate[];
}

/**
 * Sorts the candidates into groups of the same message.
 *
 * The oldest row of a group keeps the bytes: for Gmail that is the folder the
 * archive saw first. A copy only joins when it sits in another folder and its
 * checksum equals the owner's - the fingerprint says "probably the same", the
 * checksum says "the same bytes", and only the second is enough to delete a
 * file.
 */
export function groupDuplicates(rows: DuplicateCandidate[]): {
  groups: DuplicateGroup[];
  noChecksum: number;
  differing: number;
} {
  const byFingerprint = new Map<string, DuplicateCandidate[]>();
  for (const row of rows) {
    const list = byFingerprint.get(row.fingerprint) ?? [];
    list.push(row);
    byFingerprint.set(row.fingerprint, list);
  }

  const groups: DuplicateGroup[] = [];
  let noChecksum = 0;
  let differing = 0;
  for (const list of byFingerprint.values()) {
    const owner = list.find((row) => row.sha256 !== null);
    if (!owner) {
      noChecksum += list.length - 1;
      continue;
    }
    const copies: DuplicateCandidate[] = [];
    for (const row of list) {
      if (row.id === owner.id || row.folder_id === owner.folder_id) continue;
      if (row.sha256 === null) noChecksum += 1;
      else if (row.sha256 !== owner.sha256) differing += 1;
      else copies.push(row);
    }
    if (copies.length > 0) groups.push({ owner, copies });
  }
  return { groups, noChecksum, differing };
}

/** What merging would do, from the index alone; nothing is read or deleted. */
export function planDedupe(db: ArchiveDatabase, accountId: string): DedupePlan {
  const { groups, noChecksum, differing } = groupDuplicates(db.listDuplicateCandidates(accountId));

  const folders = new Map<string, { path: string; messages: number; bytes: number }>();
  let messages = 0;
  let bytes = 0;
  for (const group of groups) {
    for (const copy of group.copies) {
      const entry = folders.get(copy.folder_path) ?? { path: copy.folder_path, messages: 0, bytes: 0 };
      entry.messages += 1;
      entry.bytes += copy.size;
      folders.set(copy.folder_path, entry);
      messages += 1;
      bytes += copy.size;
    }
  }
  return { messages, bytes, noChecksum, differing, folders: [...folders.values()] };
}

export interface DedupeEngineOptions {
  db: ArchiveDatabase;
  archiveBaseDir: string;
  encryptionKey?: Buffer | null;
}

/**
 * Stores messages once that the archive holds in several folders.
 *
 * Gmail shows every mail in its folder and again in "All Mail", so an archive
 * made without "Store a message only once" has each of them twice. A copy is
 * replaced by a link only when both files are read, decrypted and match the
 * checksum taken at download - nothing is deleted on trust. The index changes
 * first, then the file goes, then the journal learns about the link, so an
 * interrupted run leaves at worst a file nothing points at, which "Check
 * archive" reports.
 */
export class DedupeEngine extends EventEmitter {
  readonly runId = randomUUID();

  private cancelled = false;
  private currentFolder: string | null = null;
  private readonly startedAt = new Date().toISOString();
  private readonly stats: DedupeStats = {
    candidates: 0,
    merged: 0,
    bytesFreed: 0,
    noChecksum: 0,
    differing: 0,
    notVerified: 0,
    failed: 0,
  };

  constructor(
    private readonly account: Account,
    private readonly options: DedupeEngineOptions,
  ) {
    super();
  }

  cancel(): void {
    this.cancelled = true;
  }

  private progress(phase: DedupePhase, error?: string): DedupeProgress {
    return {
      runId: this.runId,
      accountId: this.account.id,
      phase,
      currentFolder: this.currentFolder,
      stats: { ...this.stats },
      startedAt: this.startedAt,
      ...(error ? { error } : {}),
    };
  }

  private emitProgress(phase: DedupePhase, error?: string): void {
    this.emit('progress', this.progress(phase, error));
  }

  async run(): Promise<DedupeProgress> {
    const { db } = this.options;
    logger.info(`Merging duplicate copies for ${this.account.name}`, { accountId: this.account.id });

    try {
      const { groups, noChecksum, differing } = groupDuplicates(db.listDuplicateCandidates(this.account.id));
      this.stats.noChecksum = noChecksum;
      this.stats.differing = differing;
      this.stats.candidates = groups.reduce((sum, group) => sum + group.copies.length, 0);
      this.emitProgress('merging');

      const layout = new ArchiveLayout(this.options.archiveBaseDir);
      const accountDir = layout.accountDir(this.account);
      const key = this.options.encryptionKey ?? null;
      let sinceEmit = 0;

      for (const group of groups) {
        if (this.cancelled) throw new DedupeCancelledError();

        const ownerPath = join(accountDir, group.owner.local_path, group.owner.file_name);
        // The owner is read once for all of its copies.
        if (!(await this.matches(ownerPath, group.owner.sha256, key))) {
          this.stats.notVerified += group.copies.length;
          continue;
        }

        for (const copy of group.copies) {
          if (this.cancelled) throw new DedupeCancelledError();
          this.currentFolder = copy.folder_path;
          try {
            await this.merge(accountDir, group.owner, copy, key);
          } catch (error) {
            this.stats.failed += 1;
            logger.warn(
              `Could not merge ${copy.folder_path}/${copy.file_name}: ${(error as Error).message}`,
              { accountId: this.account.id },
            );
          }
          sinceEmit += 1;
          if (sinceEmit >= 25) {
            sinceEmit = 0;
            this.emitProgress('merging');
          }
        }
      }

      logger.info(
        `Merged ${this.stats.merged} duplicate cop${this.stats.merged === 1 ? 'y' : 'ies'} for ${this.account.name}, ${this.stats.bytesFreed} bytes freed`,
        { accountId: this.account.id },
      );
      this.currentFolder = null;
      this.emitProgress('done');
    } catch (error) {
      if (error instanceof DedupeCancelledError) {
        this.currentFolder = null;
        this.emitProgress('cancelled');
        return this.progress('cancelled');
      }
      const message = (error as Error).message;
      logger.error(`Merging duplicates failed for ${this.account.name}: ${message}`, {
        accountId: this.account.id,
      });
      this.emitProgress('failed', message);
      return this.progress('failed', message);
    }
    return this.progress('done');
  }

  private async matches(path: string, expected: string | null, key: Buffer | null): Promise<boolean> {
    if (!expected) return false;
    try {
      return sha256(await readArchiveFile(path, key)) === expected;
    } catch {
      return false;
    }
  }

  private async merge(
    accountDir: string,
    owner: DuplicateCandidate,
    copy: DuplicateCandidate,
    key: Buffer | null,
  ): Promise<void> {
    const copyDir = join(accountDir, copy.local_path);
    // The file about to go is checked as well: a damaged copy is not "the
    // same" as anything, and removing it would hide the damage.
    if (!(await this.matches(join(copyDir, copy.file_name), copy.sha256, key))) {
      this.stats.notVerified += 1;
      return;
    }

    const { db } = this.options;
    db.convertToLink(copy.id, owner.id, owner.file_name);
    await purgeMessageFile(copyDir, copy.file_name);
    await recordLink(copyDir, owner.file_name, `${owner.local_path}/${owner.file_name}`, {
      uid: copy.uid,
      uidvalidity: copy.uidvalidity,
      messageId: copy.message_id,
      fingerprint: copy.fingerprint,
      internalDate: copy.internal_date,
      size: copy.size,
      subject: copy.subject,
      from: copy.from_addr,
      to: copy.to_addr,
      flags: JSON.parse(copy.flags) as string[],
    });
    // The mark follows the file name, so the new name needs it too.
    if (copy.server_removed_at) {
      await appendJournal(copyDir, {
        op: 'server-remove',
        ts: copy.server_removed_at,
        file: owner.file_name,
      });
    }

    this.stats.merged += 1;
    this.stats.bytesFreed += copy.size;
  }
}

import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ImapFlow } from 'imapflow';
import type { ArchiveDatabase, MessageRow } from '../db/database.js';
import { toSequenceString, withConnection, type ImapConnectionOptions } from '../imap/client.js';
import { ArchiveLayout } from '../storage/archive.js';
import { appendJournal } from '../storage/journal.js';
import { openMessageFile } from '../storage/encryption.js';
import type { Account } from '../types.js';
import { messageFingerprint, type MessageIdentity } from '../util/hash.js';
import { logger } from '../util/logger.js';

export class RemovalCancelledError extends Error {
  constructor() {
    super('Removal cancelled');
    this.name = 'RemovalCancelledError';
  }
}

export type RemovalPhase = 'removing' | 'done' | 'cancelled' | 'failed';

export interface RemovalStats {
  /** What the run set out to remove. */
  candidates: number;
  /** Deleted on the server. */
  removed: number;
  bytesRemoved: number;
  /** The archived copy could not be proven good, so the server's was left alone. */
  notVerified: number;
  /** The archive has no checksum for it yet; a verification adds one. */
  noChecksum: number;
  /** The message on the server is not the one that was archived. */
  changedOnServer: number;
  /** Already gone from the server; the next backup deals with it. */
  alreadyGone: number;
  /** UIDVALIDITY changed, so the stored UIDs mean nothing. */
  skippedFolders: number;
  /** The server accepted the deletion but still lists the message. */
  stillOnServer: number;
  failed: number;
}

export interface RemovalProgress {
  runId: string;
  accountId: string;
  phase: RemovalPhase;
  currentFolder: string | null;
  stats: RemovalStats;
  startedAt: string;
  error?: string;
}

export interface RemovalOptions {
  /** IMAP folder paths; empty means every folder that holds candidates. */
  folders?: string[];
  /** Only mail received more than this many days ago. */
  olderThanDays?: number | null;
  /** UIDs per round trip. */
  batchSize?: number;
  /** Pause between two batches, to be kind to small and slow hosts. */
  pauseMs?: number;
}

export interface RemovalPlan {
  messages: number;
  bytes: number;
  /** Candidates without a checksum, which a run will leave alone. */
  noChecksum: number;
  folders: Array<{ path: string; messages: number; bytes: number }>;
}

export interface RemovalEngineOptions {
  db: ArchiveDatabase;
  archiveBaseDir: string;
  encryptionKey?: Buffer | null;
  connection: ImapConnectionOptions;
  /** Replaceable so a test can run against a stand-in for the server. */
  connect?: <T>(options: ImapConnectionOptions, fn: (client: ImapFlow) => Promise<T>) => Promise<T>;
}

const DEFAULT_BATCH = 500;
const DEFAULT_PAUSE_MS = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MISMATCHES_LOGGED_PER_FOLDER = 5;

/**
 * Which parts of a message's identity differ between the archive and the
 * server. Sizes and dates are numbers, everything else only says whether it
 * matches: the text goes into logs that people attach to bug reports.
 */
export function describeDifferences(
  stored: Pick<MessageRow, 'message_id' | 'internal_date' | 'size' | 'from_addr' | 'subject'>,
  server: MessageIdentity,
): string {
  const parts: string[] = [];

  const text = (name: string, archived: string | null | undefined, there: string | null | undefined) => {
    const a = archived ?? null;
    const b = there ?? null;
    if (a === b) return;
    if (a === null || a === '') parts.push(`${name} (empty in the archive, set on the server)`);
    else if (b === null || b === '') parts.push(`${name} (set in the archive, empty on the server)`);
    else parts.push(`${name} (different)`);
  };

  text('Message-ID', stored.message_id, server.messageId);
  const serverDate = Number.isNaN(server.internalDate.getTime()) ? null : server.internalDate.toISOString();
  if (new Date(stored.internal_date).getTime() !== server.internalDate.getTime()) {
    parts.push(`date (stored ${stored.internal_date}, server ${serverDate ?? 'invalid'})`);
  }
  if (stored.size !== server.size) parts.push(`size (stored ${stored.size}, server ${server.size})`);
  text('sender', stored.from_addr, server.fromAddress);
  // The subject only enters the fingerprint of a message without an ID.
  if (!server.messageId && !stored.message_id) {
    if ((stored.subject ?? '').trim().toLowerCase() !== (server.subject ?? '').trim().toLowerCase()) {
      parts.push('subject (different)');
    }
  }
  return parts.length > 0 ? `differs in ${parts.join(', ')}` : 'no single field differs';
}

/** What would be removed, from the index alone; nothing is read or deleted. */
export function planRemoval(
  db: ArchiveDatabase,
  accountId: string,
  options: RemovalOptions = {},
  now: Date = new Date(),
): RemovalPlan {
  const rows = db.listRemovalCandidates(accountId, {
    ...(options.folders && options.folders.length > 0 ? { folderPaths: options.folders } : {}),
    olderThanIso: olderThan(options, now),
  });

  const folders = new Map<string, { path: string; messages: number; bytes: number }>();
  let bytes = 0;
  let noChecksum = 0;
  for (const row of rows) {
    const entry = folders.get(row.folder_path) ?? { path: row.folder_path, messages: 0, bytes: 0 };
    entry.messages += 1;
    entry.bytes += row.size;
    folders.set(row.folder_path, entry);
    bytes += row.size;
    if (!db.resolveFile(row).sha256) noChecksum += 1;
  }
  return { messages: rows.length, bytes, noChecksum, folders: [...folders.values()] };
}

function olderThan(options: RemovalOptions, now: Date): string | null {
  if (!options.olderThanDays || options.olderThanDays <= 0) return null;
  return new Date(now.getTime() - options.olderThanDays * DAY_MS).toISOString();
}

/**
 * Deletes mail on the server that the archive is known to hold.
 *
 * This is the one place AmberChest writes to a mailbox, so it is built to say
 * no. A message goes only when all of these hold, checked just before it is
 * deleted and not trusted from an earlier look:
 *
 *  - the archived file is there, can be read (and decrypted), and still
 *    matches the checksum taken when it came off the server;
 *  - the folder's UIDVALIDITY is the one the stored UIDs belong to;
 *  - the message under that UID on the server has the fingerprint of the one
 *    that was archived.
 *
 * Deletion is `\Deleted` plus `UID EXPUNGE` for exactly those UIDs. A server
 * without UIDPLUS would expunge every `\Deleted` message in the folder,
 * including ones this run never looked at, so such a server is refused.
 */
export class RemovalEngine extends EventEmitter {
  readonly runId = randomUUID();

  private cancelled = false;
  private currentFolder: string | null = null;
  private readonly startedAt = new Date().toISOString();
  private mismatchesLogged = 0;
  private readonly stats: RemovalStats = {
    candidates: 0,
    removed: 0,
    bytesRemoved: 0,
    notVerified: 0,
    noChecksum: 0,
    changedOnServer: 0,
    alreadyGone: 0,
    skippedFolders: 0,
    stillOnServer: 0,
    failed: 0,
  };

  constructor(
    private readonly account: Account,
    private readonly options: RemovalEngineOptions,
    private readonly request: RemovalOptions = {},
  ) {
    super();
  }

  cancel(): void {
    this.cancelled = true;
  }

  private progress(phase: RemovalPhase, error?: string): RemovalProgress {
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

  private emitProgress(phase: RemovalPhase, error?: string): void {
    this.emit('progress', this.progress(phase, error));
  }

  private checkCancelled(): void {
    if (this.cancelled) throw new RemovalCancelledError();
  }

  async run(): Promise<RemovalProgress> {
    const { db } = this.options;
    logger.info(`Removing archived mail from the server for ${this.account.name}`, {
      accountId: this.account.id,
    });

    try {
      if (!this.account.settings.allowServerRemoval) {
        throw new Error('Removing mail from the server is not enabled for this account');
      }

      const rows = db.listRemovalCandidates(this.account.id, {
        ...(this.request.folders && this.request.folders.length > 0
          ? { folderPaths: this.request.folders }
          : {}),
        olderThanIso: olderThan(this.request, new Date()),
      });
      this.stats.candidates = rows.length;
      this.emitProgress('removing');

      const byFolder = new Map<string, Array<MessageRow & { folder_path: string }>>();
      for (const row of rows) {
        const list = byFolder.get(row.folder_path) ?? [];
        list.push(row);
        byFolder.set(row.folder_path, list);
      }

      if (rows.length > 0) {
        const connect = this.options.connect ?? withConnection;
        await connect(this.options.connection, async (client) => {
          // Checked once, before anything is flagged: see the class comment.
          if (!client.capabilities.has('UIDPLUS')) {
            throw new Error(
              'The server does not support UIDPLUS, so single messages cannot be expunged safely',
            );
          }
          for (const [path, folderRows] of byFolder) {
            this.checkCancelled();
            await this.removeFromFolder(client, path, folderRows);
          }
        });
      }

      this.currentFolder = null;
      this.emitProgress('done');
      logger.info(
        `Removal for ${this.account.name} finished: ${this.stats.removed} removed, ` +
          `${this.stats.notVerified + this.stats.noChecksum + this.stats.changedOnServer + this.stats.alreadyGone + this.stats.stillOnServer} left alone`,
        { accountId: this.account.id },
      );
      return this.progress('done');
    } catch (error) {
      if (error instanceof RemovalCancelledError) {
        this.emitProgress('cancelled');
        return this.progress('cancelled');
      }
      const message = (error as Error).message;
      this.emitProgress('failed', message);
      logger.error(`Removal for ${this.account.name} failed: ${message}`, {
        accountId: this.account.id,
      });
      return this.progress('failed', message);
    }
  }

  private async removeFromFolder(
    client: ImapFlow,
    path: string,
    rows: Array<MessageRow & { folder_path: string }>,
  ): Promise<void> {
    this.currentFolder = path;
    this.emitProgress('removing');
    const before = { ...this.stats };
    this.mismatchesLogged = 0;

    // Read-write, which is the point; everywhere else folders are EXAMINEd.
    const mailbox = await client.mailboxOpen(path, { readOnly: false });
    const uidValidity = Number(mailbox.uidValidity);

    // A stored UID belongs to one UIDVALIDITY. If the server renumbered the
    // folder, the same number now names a different message.
    const usable = rows.filter((row) => row.uidvalidity === uidValidity);
    if (usable.length !== rows.length) {
      this.stats.skippedFolders += 1;
      logger.warn(
        `${path}: UIDVALIDITY changed on the server, ${rows.length - usable.length} message(s) left alone`,
        { accountId: this.account.id },
      );
    }

    const batchSize = Math.max(1, this.request.batchSize ?? DEFAULT_BATCH);
    for (let start = 0; start < usable.length; start += batchSize) {
      this.checkCancelled();
      await this.removeBatch(client, usable.slice(start, start + batchSize));
      this.emitProgress('removing');

      if (start + batchSize < usable.length) await this.pause();
    }

    this.logFolderSummary(path, before);
  }

  /**
   * One line per folder with the reason for every message that was left
   * alone. The single messages are logged at debug level only: a folder with
   * hundreds of them would push everything else out of the log's buffer.
   */
  private logFolderSummary(path: string, before: RemovalStats): void {
    const delta = (key: keyof RemovalStats): number => this.stats[key] - before[key];
    const leftAlone =
      delta('notVerified') + delta('noChecksum') + delta('changedOnServer') + delta('alreadyGone') + delta('stillOnServer');
    const text =
      `${path}: ${delta('removed')} removed, ${leftAlone} left alone ` +
      `(archived copy not intact ${delta('notVerified')}, no checksum ${delta('noChecksum')}, ` +
      `not the archived message ${delta('changedOnServer')}, not on the server ${delta('alreadyGone')}, ` +
      `still on the server after deleting ${delta('stillOnServer')})`;
    if (leftAlone > 0 || delta('failed') > 0) logger.warn(text, { accountId: this.account.id });
    else logger.info(text, { accountId: this.account.id });
  }

  private skipped(row: MessageRow & { folder_path: string }, reason: string): void {
    logger.debug(`${row.folder_path} UID ${row.uid} (${row.file_name}) left alone: ${reason}`, {
      accountId: this.account.id,
    });
  }

  private async removeBatch(
    client: ImapFlow,
    batch: Array<MessageRow & { folder_path: string }>,
  ): Promise<void> {
    const { db } = this.options;

    // 1. The archive has to hold a good copy.
    const archived: typeof batch = [];
    for (const row of batch) {
      const { verdict, reason } = await this.archivedCopyIsGood(row);
      if (verdict === 'ok') {
        archived.push(row);
        continue;
      }
      if (verdict === 'no-checksum') this.stats.noChecksum += 1;
      else this.stats.notVerified += 1;
      this.skipped(row, reason);
    }
    if (archived.length === 0) return;

    // 2. The server has to hold the message that was archived under that UID.
    const onServer = new Map<number, { fingerprint: string; identity: MessageIdentity }>();
    for await (const message of client.fetch(
      toSequenceString(archived.map((row) => row.uid)),
      { uid: true, internalDate: true, size: true, envelope: true },
      { uid: true },
    )) {
      const envelope = message.envelope;
      const first = envelope?.from?.[0];
      const identity: MessageIdentity = {
        messageId: envelope?.messageId ?? null,
        internalDate:
          message.internalDate instanceof Date
            ? message.internalDate
            : new Date(message.internalDate ?? 0),
        fromAddress: first?.address ?? first?.name ?? null,
        subject: envelope?.subject ?? null,
        size: message.size ?? 0,
      };
      onServer.set(message.uid, { fingerprint: messageFingerprint(identity), identity });
    }

    const doomed: typeof batch = [];
    for (const row of archived) {
      const there = onServer.get(row.uid);
      const fingerprint = there?.fingerprint;
      if (there === undefined || fingerprint === undefined) {
        this.stats.alreadyGone += 1;
        this.skipped(row, 'the server has no message under this UID');
      } else if (fingerprint !== row.fingerprint) {
        this.stats.changedOnServer += 1;
        const differences = describeDifferences(row, there.identity);
        this.skipped(row, `the message under this UID is not the archived one (${differences})`);
        // The first few per folder at warn level, so the cause is in the log
        // without debug: what differs, as numbers and yes/no, never the
        // subject or an address - a log gets attached to bug reports.
        if (this.mismatchesLogged < MISMATCHES_LOGGED_PER_FOLDER) {
          this.mismatchesLogged += 1;
          logger.warn(`${row.folder_path} UID ${row.uid} is not the archived message: ${differences}`, {
            accountId: this.account.id,
          });
        }
      } else doomed.push(row);
    }
    if (doomed.length === 0) return;

    // 3. Delete exactly these, and only these.
    //
    // Marked before the deletion, not after: a crash between the two then
    // leaves mail that is marked but still on the server, which the next
    // backup notices and unmarks. The other order leaves mail that is gone
    // from the server and looks deleted elsewhere - which "mirror" answers by
    // deleting the archived copy.
    const ids = doomed.map((row) => row.id);
    db.markServerRemoved(ids);

    const range = toSequenceString(doomed.map((row) => row.uid));
    const done = await client.messageDelete(range, { uid: true }).catch(() => false);
    if (!done) {
      for (const id of ids) db.clearServerRemoved(id);
      this.stats.failed += doomed.length;
      // Flagged but not expunged would leave the mail half deleted on the
      // server; undo the flag as far as that is possible.
      await client.messageFlagsRemove(range, ['\\Deleted'], { uid: true }).catch(() => false);
      throw new Error('The server refused to delete the messages');
    }

    // A server can accept the deletion and still list the message (a trash
    // folder that keeps what is put in it, a provider that only hides it).
    // Ask again instead of taking the answer for granted.
    const remaining = await this.stillThere(client, range);
    const gone = remaining === null ? doomed : doomed.filter((row) => !remaining.has(row.uid));
    const kept = remaining === null ? [] : doomed.filter((row) => remaining.has(row.uid));
    for (const row of kept) {
      db.clearServerRemoved(row.id);
      this.stats.stillOnServer += 1;
      this.skipped(row, 'the server still lists the message after the deletion');
    }
    if (gone.length === 0) return;

    await this.writeJournal(gone);
    this.stats.removed += gone.length;
    this.stats.bytesRemoved += gone.reduce((sum, row) => sum + row.size, 0);
  }

  /**
   * The UIDs of the range the server still lists, or null when it cannot be
   * asked - the deletion was acknowledged, so that is then taken as it is.
   */
  private async stillThere(client: ImapFlow, range: string): Promise<Set<number> | null> {
    try {
      const found = await client.search({ uid: range }, { uid: true });
      return new Set(Array.isArray(found) ? found : []);
    } catch (error) {
      logger.warn(`Could not check the deletion in ${this.currentFolder}: ${(error as Error).message}`, {
        accountId: this.account.id,
      });
      return null;
    }
  }

  /**
   * Puts the removal in each folder's journal, which is what an index rebuilt
   * from the files reads it back from.
   *
   * A journal that cannot be written is logged and not fatal: the index has
   * the mark, which is what the next backup goes by, and the mail is already
   * gone from the server.
   */
  private async writeJournal(rows: Array<MessageRow & { folder_path: string }>): Promise<void> {
    const layout = new ArchiveLayout(this.options.archiveBaseDir);
    const accountDir = layout.accountDir(this.account);
    const folders = this.options.db.listFolders(this.account.id);
    const ts = new Date().toISOString();

    for (const row of rows) {
      const folder = folders.find((entry) => entry.id === row.folder_id);
      if (!folder) continue;
      try {
        await appendJournal(join(accountDir, folder.local_path), {
          op: 'server-remove',
          ts,
          file: row.file_name,
        });
      } catch (error) {
        logger.warn(`Could not journal the removal of ${row.file_name}: ${(error as Error).message}`, {
          accountId: this.account.id,
        });
      }
    }
  }

  /**
   * Whether the archive really holds this message.
   *
   * Linked rows are checked through the file's owner. A row without a checksum
   * is not accepted on the strength of the file merely being readable: that
   * would only prove the file exists, not that it is the mail.
   */
  private async archivedCopyIsGood(
    row: MessageRow,
  ): Promise<{ verdict: 'ok' | 'no-checksum' | 'bad'; reason: string }> {
    const { db } = this.options;
    const owner = db.resolveFile(row);
    if (owner.state !== 'active') return { verdict: 'bad', reason: `the file's owner is ${owner.state}` };
    if (!owner.sha256) return { verdict: 'no-checksum', reason: 'no checksum in the index' };

    const folder = db.listFolders(this.account.id).find((entry) => entry.id === owner.folder_id);
    if (!folder) return { verdict: 'bad', reason: "the file's folder is unknown" };

    const layout = new ArchiveLayout(this.options.archiveBaseDir);
    const path = join(layout.accountDir(this.account), folder.local_path, owner.file_name);
    let plain: Buffer;
    try {
      plain = openMessageFile(await readFile(path), this.options.encryptionKey ?? null);
    } catch (error) {
      return { verdict: 'bad', reason: `the file cannot be read (${(error as Error).message})` };
    }
    if (plain.length === 0) return { verdict: 'bad', reason: 'the file is empty' };
    if (createHash('sha256').update(plain).digest('hex') !== owner.sha256) {
      return { verdict: 'bad', reason: 'the checksum of the file does not match' };
    }
    return { verdict: 'ok', reason: '' };
  }

  private async pause(): Promise<void> {
    const ms = this.request.pauseMs ?? DEFAULT_PAUSE_MS;
    const step = 250;
    for (let waited = 0; waited < ms; waited += step) {
      this.checkCancelled();
      await new Promise((resolve) => setTimeout(resolve, Math.min(step, ms - waited)));
    }
  }
}

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { ImapFlow } from 'imapflow';
import { describeImapError, withConnection, type ImapConnectionOptions } from '../imap/client.js';
import { loadMessageSource } from '../search/message.js';
import { searchMessages, type SearchOptions } from '../search/search.js';
import type { ArchiveDatabase } from '../db/database.js';
import type { Account } from '../types.js';
import { logger } from '../util/logger.js';

export class RestoreCancelledError extends Error {
  constructor() {
    super('Restore cancelled');
    this.name = 'RestoreCancelledError';
  }
}

export interface RestoreStats {
  messagesTotal: number;
  messagesDone: number;
  messagesUploaded: number;
  /** Already present at the target, recognised by Message-ID. */
  messagesSkipped: number;
  messagesFailed: number;
  foldersCreated: number;
  bytesUploaded: number;
}

export type RestorePhase =
  | 'connecting'
  | 'preparing'
  | 'uploading'
  | 'done'
  | 'cancelled'
  | 'failed';

export interface RestoreProgress {
  runId: string;
  phase: RestorePhase;
  currentFolder: string | null;
  stats: RestoreStats;
  startedAt: string;
  error?: string;
}

/** One archived folder and where its messages should land. */
export interface FolderMapping {
  /** IMAP path as recorded in the archive. */
  source: string;
  /** IMAP path on the target server; empty means "do not restore this one". */
  target: string;
}

export interface RestoreOptions {
  db: ArchiveDatabase;
  archiveBaseDir: string;
  /** Account the messages are read from. */
  sourceAccount: Account;
  /** Where to upload; may be a different server entirely. */
  target: ImapConnectionOptions;
  mappings: FolderMapping[];
  /** Restricts which archived messages are considered. */
  selection: SearchOptions;
  /** Skip messages whose Message-ID already exists in the target folder. */
  skipExisting: boolean;
  /** Restore \Seen, \Answered and \Flagged as recorded at backup time. */
  restoreFlags: boolean;
}

/**
 * Uploads archived messages back to an IMAP server.
 *
 * This is the only part of Mail Archiver that writes to a mail server. It only
 * ever appends: nothing existing is deleted, moved or modified, and messages
 * that are already there are skipped rather than duplicated.
 */
export class RestoreEngine extends EventEmitter {
  readonly runId = randomUUID();

  private cancelled = false;
  private readonly stats: RestoreStats = {
    messagesTotal: 0,
    messagesDone: 0,
    messagesUploaded: 0,
    messagesSkipped: 0,
    messagesFailed: 0,
    foldersCreated: 0,
    bytesUploaded: 0,
  };
  private readonly startedAt = new Date().toISOString();
  private currentFolder: string | null = null;

  constructor(private readonly options: RestoreOptions) {
    super();
  }

  cancel(): void {
    this.cancelled = true;
  }

  private checkCancelled(): void {
    if (this.cancelled) throw new RestoreCancelledError();
  }

  private emitProgress(phase: RestorePhase, error?: string): void {
    this.emit('progress', {
      runId: this.runId,
      phase,
      currentFolder: this.currentFolder,
      stats: { ...this.stats },
      startedAt: this.startedAt,
      ...(error ? { error } : {}),
    } satisfies RestoreProgress);
  }

  async run(): Promise<RestoreStats> {
    this.emitProgress('connecting');
    logger.warn(
      `Restore started: writing to ${this.options.target.host} as ${this.options.target.username}`,
    );

    try {
      await withConnection(this.options.target, async (client) => {
        await this.execute(client);
      });
      this.emitProgress('done');
      logger.info(
        `Restore finished: ${this.stats.messagesUploaded} uploaded, ${this.stats.messagesSkipped} already there`,
      );
      return this.stats;
    } catch (error) {
      if (error instanceof RestoreCancelledError) {
        this.emitProgress('cancelled');
        return this.stats;
      }
      const message = describeImapError(error);
      this.emitProgress('failed', message);
      logger.error(`Restore failed: ${message}`);
      throw error;
    }
  }

  private async execute(client: ImapFlow): Promise<void> {
    this.emitProgress('preparing');

    const active = this.options.mappings.filter((mapping) => mapping.target.trim() !== '');
    const hits = searchMessages(this.options.db, {
      ...this.options.selection,
      accountId: this.options.sourceAccount.id,
      limit: 100_000,
      offset: 0,
    }).hits;

    const wanted = new Set(active.map((mapping) => mapping.source));
    const selected = hits.filter((hit) => wanted.has(hit.folderPath));
    this.stats.messagesTotal = selected.length;

    const targetOf = new Map(active.map((mapping) => [mapping.source, mapping.target.trim()]));
    const existingFolders = new Set(
      (await client.list({ listOnly: true })).map((folder) => folder.path),
    );

    // Group by target folder so each one is opened and scanned only once.
    const byTarget = new Map<string, typeof selected>();
    for (const hit of selected) {
      const target = targetOf.get(hit.folderPath);
      if (!target) continue;
      const list = byTarget.get(target) ?? [];
      list.push(hit);
      byTarget.set(target, list);
    }

    this.emitProgress('uploading');

    for (const [target, messages] of byTarget) {
      this.checkCancelled();
      this.currentFolder = target;

      if (!existingFolders.has(target)) {
        try {
          await client.mailboxCreate(target);
          existingFolders.add(target);
          this.stats.foldersCreated += 1;
          logger.info(`Created folder ${target} on the target server`);
        } catch (error) {
          // Some servers report an existing folder as an error; carry on.
          logger.debug(`Could not create ${target}: ${describeImapError(error)}`);
        }
      }

      const present = this.options.skipExisting ? await this.messageIdsIn(client, target) : new Set<string>();

      // APPEND silently drops its flags while a mailbox is open, so the
      // duplicate check has to let go of the mailbox before uploading.
      // Verified against imapflow 2.0 and Dovecot: with an open mailbox the
      // message arrives with \\Recent only.
      if (client.mailbox) await client.mailboxClose();

      for (const hit of messages) {
        this.checkCancelled();
        await this.uploadOne(client, target, hit, present);
        this.stats.messagesDone += 1;
        if (this.stats.messagesDone % 10 === 0) this.emitProgress('uploading');
      }
    }
  }

  /**
   * Collects the Message-IDs already present in a target folder.
   *
   * The caller must close the mailbox afterwards - see the note at the call
   * site about APPEND losing its flags.
   */
  private async messageIdsIn(client: ImapFlow, path: string): Promise<Set<string>> {
    const ids = new Set<string>();
    try {
      const mailbox = await client.mailboxOpen(path, { readOnly: true });
      if (mailbox.exists === 0) return ids;

      for await (const message of client.fetch('1:*', { uid: true, envelope: true }, { uid: true })) {
        const id = message.envelope?.messageId;
        if (id) ids.add(id);
      }
    } catch (error) {
      logger.debug(`Cannot read ${path} for duplicate check: ${describeImapError(error)}`);
    }
    return ids;
  }

  private async uploadOne(
    client: ImapFlow,
    target: string,
    hit: { messageId: number; internalDate: string; flags: string[] },
    present: Set<string>,
  ): Promise<void> {
    const row = this.options.db.getMessage(hit.messageId);
    if (!row) {
      this.stats.messagesFailed += 1;
      return;
    }

    if (this.options.skipExisting && row.message_id && present.has(row.message_id)) {
      this.stats.messagesSkipped += 1;
      return;
    }

    let source: Buffer;
    try {
      const loaded = await loadMessageSource(this.options.sourceAccount, hit.messageId, {
        db: this.options.db,
        archiveBaseDir: this.options.archiveBaseDir,
      });
      source = loaded.source;
    } catch {
      this.stats.messagesFailed += 1;
      return;
    }

    // \Recent is server managed and must never be sent.
    const flags = this.options.restoreFlags
      ? (JSON.parse(row.flags) as string[]).filter((flag) => flag !== '\\Recent')
      : [];

    try {
      await client.append(target, source, flags, new Date(row.internal_date));
      this.stats.messagesUploaded += 1;
      this.stats.bytesUploaded += source.length;
      if (row.message_id) present.add(row.message_id);
    } catch (error) {
      this.stats.messagesFailed += 1;
      logger.warn(`Upload of ${row.file_name} failed: ${describeImapError(error)}`);
    }
  }
}

/** Special use markers used to line up folders across servers. */
const SPECIAL_USE_ORDER = ['\\Inbox', '\\Sent', '\\Drafts', '\\Archive', '\\Trash', '\\Junk'];

export interface MappingSuggestionInput {
  /** Archived folders: path plus the special use recorded at backup time. */
  source: Array<{ path: string; specialUse: string | null }>;
  /** Folders that exist on the target server. */
  target: Array<{ path: string; specialUse: string | null; delimiter: string }>;
}

/**
 * Proposes a folder mapping for a move to another server.
 *
 * Special use folders are matched first - "Gesendete Objekte" on one server is
 * "Sent" on the next - then identical names, then the path as it was. Anything
 * left over keeps its original path, which the target server will create.
 */
export function suggestMappings({ source, target }: MappingSuggestionInput): FolderMapping[] {
  const targetBySpecial = new Map<string, string>();
  for (const folder of target) {
    if (folder.specialUse && !targetBySpecial.has(folder.specialUse)) {
      targetBySpecial.set(folder.specialUse, folder.path);
    }
  }

  const targetByLeaf = new Map<string, string>();
  for (const folder of target) {
    const leaf = folder.delimiter
      ? (folder.path.split(folder.delimiter).pop() ?? folder.path)
      : folder.path;
    const key = leaf.toLowerCase();
    if (!targetByLeaf.has(key)) targetByLeaf.set(key, folder.path);
  }

  const targetPaths = new Set(target.map((folder) => folder.path));

  return source.map((folder) => {
    if (folder.specialUse && SPECIAL_USE_ORDER.includes(folder.specialUse)) {
      const match = targetBySpecial.get(folder.specialUse);
      if (match) return { source: folder.path, target: match };
    }

    if (targetPaths.has(folder.path)) return { source: folder.path, target: folder.path };

    const leaf = folder.path.split(/[./]/).pop() ?? folder.path;
    const byName = targetByLeaf.get(leaf.toLowerCase());
    if (byName) return { source: folder.path, target: byName };

    // Nothing matched: keep the path, the server will create it.
    return { source: folder.path, target: folder.path };
  });
}

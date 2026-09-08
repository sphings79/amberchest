import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { simpleParser } from 'mailparser';
import { extractAttachments } from '../attachments/extract.js';
import type { ArchiveDatabase, FolderRow, MessageRow } from '../db/database.js';
import { ArchiveLayout, readArchiveFile } from '../storage/archive.js';
import type { Account } from '../types.js';
import { logger } from '../util/logger.js';
import { withFoldedVariants } from './fold.js';
import { extractText, isExtractable } from './text.js';

export class IndexCancelledError extends Error {
  constructor() {
    super('Indexing cancelled');
    this.name = 'IndexCancelledError';
  }
}

export interface IndexStats {
  messagesTotal: number;
  messagesDone: number;
  messagesIndexed: number;
  messagesFailed: number;
  attachmentsRead: number;
  charactersIndexed: number;
}

export type IndexPhase = 'scanning' | 'indexing' | 'done' | 'cancelled' | 'failed';

export interface IndexProgress {
  runId: string;
  accountId: string;
  phase: IndexPhase;
  stats: IndexStats;
  startedAt: string;
  error?: string;
}

export interface IndexEngineOptions {
  db: ArchiveDatabase;
  archiveBaseDir: string;
  /** Read text out of PDF and Office attachments as well. */
  indexAttachments: boolean;
  /** Attachments larger than this are not opened; 0 disables the limit. */
  maxAttachmentBytes: number;
  /** Needed when the archive is encrypted. */
  encryptionKey?: Buffer | null;
}

/**
 * Fills the full text index from the archived .eml files.
 *
 * Runs over everything that has no index entry yet, so it can be interrupted
 * and resumed, and a backup that added new mail only costs the new messages.
 */
export class SearchIndexEngine extends EventEmitter {
  readonly runId = randomUUID();

  private cancelled = false;
  private readonly stats: IndexStats = {
    messagesTotal: 0,
    messagesDone: 0,
    messagesIndexed: 0,
    messagesFailed: 0,
    attachmentsRead: 0,
    charactersIndexed: 0,
  };
  private readonly layout: ArchiveLayout;
  private readonly startedAt = new Date().toISOString();

  constructor(
    private readonly account: Account,
    private readonly options: IndexEngineOptions,
  ) {
    super();
    this.layout = new ArchiveLayout(options.archiveBaseDir);
  }

  cancel(): void {
    this.cancelled = true;
  }

  private emitProgress(phase: IndexPhase, error?: string): void {
    const progress: IndexProgress = {
      runId: this.runId,
      accountId: this.account.id,
      phase,
      stats: { ...this.stats },
      startedAt: this.startedAt,
      ...(error ? { error } : {}),
    };
    this.emit('progress', progress);
  }

  async run(): Promise<IndexStats> {
    const db = this.options.db;
    db.startIndexRun(this.runId, this.account.id);
    this.emitProgress('scanning');

    try {
      const messages = db.listUnindexedMessages(this.account.id);
      this.stats.messagesTotal = messages.length;
      this.emitProgress('indexing');

      const folders = new Map(db.listFolders(this.account.id).map((row) => [row.id, row]));
      const accountDir = this.layout.accountDir(this.account);

      for (const message of messages) {
        if (this.cancelled) throw new IndexCancelledError();
        const folder = folders.get(message.folder_id);
        if (folder) await this.indexMessage(accountDir, folder, message);
        this.stats.messagesDone += 1;
        if (this.stats.messagesDone % 50 === 0) this.emitProgress('indexing');
      }

      db.finishIndexRun(this.runId, 'done', this.stats);
      this.emitProgress('done');
      logger.info(
        `Indexed ${this.stats.messagesIndexed} message(s) for ${this.account.name}`,
        { accountId: this.account.id },
      );
      return this.stats;
    } catch (error) {
      if (error instanceof IndexCancelledError) {
        db.finishIndexRun(this.runId, 'cancelled', this.stats);
        this.emitProgress('cancelled');
        return this.stats;
      }
      const message = (error as Error).message;
      db.finishIndexRun(this.runId, 'failed', this.stats, message);
      this.emitProgress('failed', message);
      throw error;
    }
  }

  private async indexMessage(
    accountDir: string,
    folder: FolderRow,
    message: MessageRow,
  ): Promise<void> {
    // A linked message keeps its bytes in the folder that owns them.
    const owner = this.options.db.resolveFile(message);
    const ownerFolder =
      owner.id === message.id
        ? folder
        : this.options.db.listFolders(owner.account_id).find((entry) => entry.id === owner.folder_id);
    const path = join(accountDir, (ownerFolder ?? folder).local_path, owner.file_name);

    let source: Buffer;
    try {
      source = await readArchiveFile(path, this.options.encryptionKey ?? null);
    } catch {
      this.stats.messagesFailed += 1;
      return;
    }

    try {
      const parsed = await simpleParser(source, { skipTextLinks: true });
      const body = (parsed.text ?? '').trim() || stripHtml(parsed.html || '');

      let attachmentText = '';
      if (this.options.indexAttachments) {
        attachmentText = await this.readAttachments(source);
      }

      this.options.db.upsertMessageText({
        messageId: message.id,
        accountId: this.account.id,
        // German transliterations are indexed next to the original spelling,
        // so "muenchen" and "München" find the same message.
        subject: message.subject ? withFoldedVariants(message.subject) : null,
        fromAddr: message.from_addr,
        toAddr: message.to_addr,
        body: withFoldedVariants(body),
        attachmentText: withFoldedVariants(attachmentText),
      });

      this.stats.messagesIndexed += 1;
      this.stats.charactersIndexed += body.length + attachmentText.length;
    } catch (error) {
      this.stats.messagesFailed += 1;
      logger.debug(`Cannot index ${message.file_name}: ${(error as Error).message}`, {
        accountId: this.account.id,
      });
    }
  }

  private async readAttachments(source: Buffer): Promise<string> {
    const limit = this.options.maxAttachmentBytes;
    const parts: string[] = [];

    for (const attachment of await extractAttachments(source)) {
      if (attachment.inline) continue;
      if (limit > 0 && attachment.size > limit) continue;
      if (!isExtractable(attachment.contentType, attachment.fileName)) continue;

      const text = await extractText(attachment.content, attachment.contentType, attachment.fileName);
      if (text) {
        parts.push(`${attachment.originalName} ${text}`);
        this.stats.attachmentsRead += 1;
      }
    }

    return parts.join(' ');
  }
}

/** Very small HTML to text fallback for messages without a plain text part. */
function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/p>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

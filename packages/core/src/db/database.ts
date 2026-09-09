import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import type BetterSqlite3 from 'better-sqlite3';
import { databaseFilePath } from '../config/locations.js';
import type { RemoteFolder, SyncStats } from '../types.js';
import { migrate } from './schema.js';

export interface FolderRow {
  id: number;
  account_id: string;
  path: string;
  local_path: string;
  delimiter: string;
  special_use: string | null;
  no_select: number;
  uidvalidity: number | null;
  uidnext: number | null;
  selected: number;
  first_seen: string;
  last_sync: string | null;
}

/** A row of the "largest messages" lists on the statistics screen. */
export interface LargestMessage {
  id: number;
  accountId: string;
  folderPath: string;
  subject: string | null;
  from: string | null;
  date: string;
  size: number;
  attachmentBytes: number;
  attachmentCount: number;
}

export interface MessageRow {
  id: number;
  account_id: string;
  folder_id: number;
  uid: number;
  uidvalidity: number;
  message_id: string | null;
  fingerprint: string;
  internal_date: string;
  size: number;
  subject: string | null;
  from_addr: string | null;
  to_addr: string | null;
  flags: string;
  file_name: string;
  /** Checksum of the message source; null for rows written before that existed. */
  sha256: string | null;
  /** Set when the bytes live with another message of the same account. */
  linked_to: number | null;
  state: 'active' | 'deleted';
  deleted_at: string | null;
  created_at: string;
}

export interface AttachmentRow {
  id: number;
  account_id: string;
  message_id: number;
  original_name: string;
  content_type: string | null;
  size: number;
  sha256: string;
  inline: number;
  export_path: string;
  deduplicated: number;
  exported_at: string;
}

export interface NewAttachment {
  accountId: string;
  messageId: number;
  originalName: string;
  contentType: string | null;
  size: number;
  sha256: string;
  inline: boolean;
  exportPath: string;
  deduplicated: boolean;
}

export interface NewMessage {
  accountId: string;
  folderId: number;
  uid: number;
  uidvalidity: number;
  messageId: string | null;
  fingerprint: string;
  internalDate: string;
  size: number;
  subject: string | null;
  fromAddr: string | null;
  toAddr: string | null;
  flags: string[];
  fileName: string;
  /** Checksum of the message source, for the archive check. */
  sha256?: string | null;
  /** Set when the bytes live with another message of the same account. */
  linkedTo?: number | null;
}

/**
 * Index and sync state for all accounts.
 *
 * Nothing in here is a source of truth: the .eml files plus the per folder
 * journal are. This database exists so a sync run does not have to walk the
 * whole archive, and later on it carries the search index.
 */
export class ArchiveDatabase {
  private readonly db: BetterSqlite3.Database;

  constructor(filePath: string = databaseFilePath()) {
    mkdirSync(dirname(filePath), { recursive: true });
    this.db = new Database(filePath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('synchronous = NORMAL');
    migrate(this.db);
  }

  get handle(): BetterSqlite3.Database {
    return this.db;
  }

  close(): void {
    this.db.close();
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  // ---------------------------------------------------------------- folders

  listFolders(accountId: string): FolderRow[] {
    return this.db
      .prepare('SELECT * FROM folders WHERE account_id = ? ORDER BY path')
      .all(accountId) as FolderRow[];
  }

  getFolderByPath(accountId: string, path: string): FolderRow | undefined {
    return this.db
      .prepare('SELECT * FROM folders WHERE account_id = ? AND path = ?')
      .get(accountId, path) as FolderRow | undefined;
  }

  /** Inserts a folder on first sight, refreshes its metadata afterwards. */
  upsertFolder(accountId: string, folder: RemoteFolder, localPath: string): FolderRow {
    const existing = this.getFolderByPath(accountId, folder.path);
    if (existing) {
      this.db
        .prepare(
          `UPDATE folders
              SET local_path = ?, delimiter = ?, special_use = ?, no_select = ?
            WHERE id = ?`,
        )
        .run(localPath, folder.delimiter, folder.specialUse, folder.noSelect ? 1 : 0, existing.id);
      return this.getFolderByPath(accountId, folder.path) as FolderRow;
    }

    this.db
      .prepare(
        `INSERT INTO folders (account_id, path, local_path, delimiter, special_use, no_select, first_seen)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        accountId,
        folder.path,
        localPath,
        folder.delimiter,
        folder.specialUse,
        folder.noSelect ? 1 : 0,
        new Date().toISOString(),
      );
    return this.getFolderByPath(accountId, folder.path) as FolderRow;
  }

  /** Renames a folder that changed its path on the server. */
  renameFolder(folderId: number, newPath: string, newLocalPath: string): void {
    this.db
      .prepare('UPDATE folders SET path = ?, local_path = ? WHERE id = ?')
      .run(newPath, newLocalPath, folderId);
  }

  setSelectedFolders(accountId: string, paths: string[]): void {
    const selected = new Set(paths);
    this.transaction(() => {
      this.db.prepare('UPDATE folders SET selected = 0 WHERE account_id = ?').run(accountId);
      const stmt = this.db.prepare('UPDATE folders SET selected = 1 WHERE account_id = ? AND path = ?');
      for (const path of selected) stmt.run(accountId, path);
    });
  }

  updateFolderSyncState(
    folderId: number,
    state: { uidvalidity?: number | null; uidnext?: number | null; lastSync?: string | null },
  ): void {
    this.db
      .prepare(
        `UPDATE folders
            SET uidvalidity = COALESCE(?, uidvalidity),
                uidnext     = COALESCE(?, uidnext),
                last_sync   = COALESCE(?, last_sync)
          WHERE id = ?`,
      )
      .run(state.uidvalidity ?? null, state.uidnext ?? null, state.lastSync ?? null, folderId);
  }

  deleteFolder(folderId: number): void {
    this.db.prepare('DELETE FROM folders WHERE id = ?').run(folderId);
  }

  /** Every message of a folder, whatever its state, for discarding the folder. */
  listMessagesInFolder(folderId: number): MessageRow[] {
    return this.db
      .prepare('SELECT * FROM messages WHERE folder_id = ? ORDER BY uid')
      .all(folderId) as MessageRow[];
  }

  /**
   * Removes a folder and everything the index knows about its messages.
   *
   * The indexed text and the attachment rows follow on their own: both tables
   * reference messages with ON DELETE CASCADE, foreign keys are enabled, and
   * the trigger on message_text takes the rows out of the search index.
   */
  deleteFolderContents(folderId: number): void {
    this.transaction(() => {
      this.db.prepare('DELETE FROM messages WHERE folder_id = ?').run(folderId);
      this.db.prepare('DELETE FROM folders WHERE id = ?').run(folderId);
    });
  }

  // --------------------------------------------------------------- messages

  listActiveMessages(folderId: number): MessageRow[] {
    return this.db
      .prepare("SELECT * FROM messages WHERE folder_id = ? AND state = 'active' ORDER BY uid")
      .all(folderId) as MessageRow[];
  }

  countMessages(folderId: number): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS count FROM messages WHERE folder_id = ? AND state = 'active'")
      .get(folderId) as { count: number };
    return row.count;
  }

  countMessagesByAccount(accountId: string): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS count FROM messages WHERE account_id = ? AND state = 'active'")
      .get(accountId) as { count: number };
    return row.count;
  }

  /** Total size of the archived messages of one account, in bytes. */
  /** Size of the archive on disk: a message shared by two folders counts once. */
  totalBytes(accountId: string): number {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(size), 0) AS bytes FROM messages
          WHERE account_id = ? AND state = 'active' AND linked_to IS NULL`,
      )
      .get(accountId) as { bytes: number };
    return row.bytes;
  }

  countDeletedMessages(accountId: string): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS count FROM messages WHERE account_id = ? AND state = 'deleted'")
      .get(accountId) as { count: number };
    return row.count;
  }

  findByFingerprint(accountId: string, fingerprint: string): MessageRow[] {
    return this.db
      .prepare('SELECT * FROM messages WHERE account_id = ? AND fingerprint = ?')
      .all(accountId, fingerprint) as MessageRow[];
  }

  getMessage(id: number): MessageRow | undefined {
    return this.db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as MessageRow | undefined;
  }

  insertMessage(message: NewMessage): number {
    const result = this.db
      .prepare(
        `INSERT INTO messages (
           account_id, folder_id, uid, uidvalidity, message_id, fingerprint, internal_date,
           size, subject, from_addr, to_addr, flags, file_name, sha256, linked_to, state, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
      )
      .run(
        message.accountId,
        message.folderId,
        message.uid,
        message.uidvalidity,
        message.messageId,
        message.fingerprint,
        message.internalDate,
        message.size,
        message.subject,
        message.fromAddr,
        message.toAddr,
        JSON.stringify(message.flags),
        message.fileName,
        message.sha256 ?? null,
        message.linkedTo ?? null,
        new Date().toISOString(),
      );
    return Number(result.lastInsertRowid);
  }

  /** Every message of an account, in the order they sit on disk. */
  listMessagesForVerify(
    accountId: string,
    includeDeleted: boolean,
  ): Array<{
    id: number;
    folder_path: string;
    local_path: string;
    file_name: string;
    size: number;
    sha256: string | null;
    linked_to: number | null;
    uid: number;
    state: string;
    subject: string | null;
    internal_date: string;
  }> {
    const where = includeDeleted ? '' : " AND m.state = 'active'";
    return this.db
      .prepare(
        `SELECT m.id, f.path AS folder_path, f.local_path AS local_path, m.file_name, m.size,
                m.sha256, m.linked_to, m.uid, m.state, m.subject, m.internal_date
           FROM messages m JOIN folders f ON f.id = m.folder_id
          WHERE m.account_id = ?${where}
          ORDER BY f.path, m.internal_date`,
      )
      .all(accountId) as Array<{
      id: number;
      folder_path: string;
      local_path: string;
      file_name: string;
      size: number;
      sha256: string | null;
      linked_to: number | null;
      uid: number;
      state: string;
      subject: string | null;
      internal_date: string;
    }>;
  }

  /**
   * The message whose file holds the bytes.
   *
   * A linked row carries no file of its own; everything that reads a message
   * goes through here first.
   */
  resolveFile(row: MessageRow): MessageRow {
    if (!row.linked_to) return row;
    const owner = this.getMessage(row.linked_to);
    return owner ?? row;
  }

  /** Rows whose bytes live with this message. */
  listLinks(messageId: number): MessageRow[] {
    return this.db
      .prepare("SELECT * FROM messages WHERE linked_to = ?")
      .all(messageId) as MessageRow[];
  }

  /** Hands the file over to another row, which then owns it. */
  promoteLink(linkId: number, fileName: string, folderId: number): void {
    this.transaction(() => {
      this.db
        .prepare('UPDATE messages SET linked_to = NULL, file_name = ?, folder_id = ? WHERE id = ?')
        .run(fileName, folderId, linkId);
      // Everything that pointed at the old owner now points at the new one.
      this.db.prepare('UPDATE messages SET linked_to = ? WHERE linked_to = ?').run(linkId, linkId);
    });
  }

  /** Re-points the links of one message at another. */
  relinkTo(fromId: number, toId: number): void {
    this.db.prepare('UPDATE messages SET linked_to = ? WHERE linked_to = ?').run(toId, fromId);
  }

  /** An active message of this account with the same content, if there is one. */
  findLinkTarget(accountId: string, fingerprint: string, excludeFolderId: number): MessageRow | undefined {
    return this.db
      .prepare(
        `SELECT * FROM messages
          WHERE account_id = ? AND fingerprint = ? AND state = 'active'
            AND folder_id != ? AND linked_to IS NULL
          LIMIT 1`,
      )
      .get(accountId, fingerprint, excludeFolderId) as MessageRow | undefined;
  }

  /** One message by its file name, for adopting an archive without duplicates. */
  findMessageByFile(accountId: string, folderId: number, fileName: string): MessageRow | undefined {
    return this.db
      .prepare('SELECT * FROM messages WHERE account_id = ? AND folder_id = ? AND file_name = ?')
      .get(accountId, folderId, fileName) as MessageRow | undefined;
  }

  /** Fills in a checksum that an older version did not write yet. */
  setMessageHash(id: number, sha256: string): void {
    this.db.prepare('UPDATE messages SET sha256 = ? WHERE id = ?').run(sha256, id);
  }

  /** Active messages per folder, for the comparison with the server. */
  countActiveByFolder(accountId: string): Map<string, number> {
    const rows = this.db
      .prepare(
        `SELECT f.path AS path, COUNT(*) AS count
           FROM messages m JOIN folders f ON f.id = m.folder_id
          WHERE m.account_id = ? AND m.state = 'active'
          GROUP BY f.path`,
      )
      .all(accountId) as Array<{ path: string; count: number }>;
    return new Map(rows.map((row) => [row.path, row.count]));
  }

  /**
   * The biggest messages, by the message itself or by what it carries.
   *
   * Two different questions: a long thread is a large message with no
   * attachment at all, while one photograph makes a small message a large
   * file. The folder comes along because "which one is it" is the first
   * thing anybody asks of such a list.
   */
  largestMessages(
    accountId: string | null,
    by: 'size' | 'attachments',
    limit: number,
    offset: number,
  ): LargestMessage[] {
    const where = accountId ? 'AND m.account_id = @accountId' : '';
    const params = { accountId, limit, offset };

    if (by === 'attachments') {
      return this.db
        .prepare(
          `SELECT m.id AS id, m.account_id AS accountId, f.path AS folderPath, m.subject AS subject,
                  m.from_addr AS "from", m.internal_date AS date, m.size AS size,
                  COALESCE(SUM(a.size), 0) AS attachmentBytes, COUNT(a.id) AS attachmentCount
             FROM messages m
             JOIN folders f ON f.id = m.folder_id
             JOIN attachments a ON a.message_id = m.id
            WHERE m.state = 'active' ${where}
            GROUP BY m.id
            ORDER BY attachmentBytes DESC
            LIMIT @limit OFFSET @offset`,
        )
        .all(params) as LargestMessage[];
    }

    return this.db
      .prepare(
        `SELECT m.id AS id, m.account_id AS accountId, f.path AS folderPath, m.subject AS subject,
                m.from_addr AS "from", m.internal_date AS date, m.size AS size,
                (SELECT COALESCE(SUM(a.size), 0) FROM attachments a WHERE a.message_id = m.id)
                  AS attachmentBytes,
                (SELECT COUNT(*) FROM attachments a WHERE a.message_id = m.id) AS attachmentCount
           FROM messages m
           JOIN folders f ON f.id = m.folder_id
          WHERE m.state = 'active' ${where}
          ORDER BY m.size DESC
          LIMIT @limit OFFSET @offset`,
      )
      .all(params) as LargestMessage[];
  }

  /**
   * Numbers for the statistics screen.
   *
   * All of it comes out of the index, so nothing has to be read from disk and
   * nothing has to be asked of the server.
   */
  statistics(accountId: string | null): {
    perYear: Array<{ year: string; messages: number; bytes: number }>;
    perFolder: Array<{ path: string; messages: number; bytes: number }>;
    topSenders: Array<{ address: string; messages: number; bytes: number }>;
    largest: LargestMessage[];
    attachments: { files: number; bytes: number; byType: Array<{ type: string; files: number; bytes: number }> };
    totals: { messages: number; bytes: number; deleted: number; linked: number; withAttachments: number };
    range: { first: string | null; last: string | null };
  } {
    const where = accountId ? 'AND m.account_id = @accountId' : '';
    const params = accountId ? { accountId } : {};
    const active = `FROM messages m WHERE m.state = 'active' ${where}`;

    const perYear = this.db
      .prepare(
        `SELECT substr(m.internal_date, 1, 4) AS year, COUNT(*) AS messages,
                COALESCE(SUM(m.size), 0) AS bytes
           ${active}
          GROUP BY year ORDER BY year`,
      )
      .all(params) as Array<{ year: string; messages: number; bytes: number }>;

    const perFolder = this.db
      .prepare(
        `SELECT f.path AS path, COUNT(*) AS messages, COALESCE(SUM(m.size), 0) AS bytes
           FROM messages m JOIN folders f ON f.id = m.folder_id
          WHERE m.state = 'active' ${where}
          GROUP BY f.path ORDER BY messages DESC LIMIT 25`,
      )
      .all(params) as Array<{ path: string; messages: number; bytes: number }>;

    const topSenders = this.db
      .prepare(
        `SELECT COALESCE(m.from_addr, '?') AS address, COUNT(*) AS messages,
                COALESCE(SUM(m.size), 0) AS bytes
           ${active}
          GROUP BY address ORDER BY messages DESC LIMIT 15`,
      )
      .all(params) as Array<{ address: string; messages: number; bytes: number }>;

    const largest = this.largestMessages(accountId, 'size', 10, 0);

    const attachmentWhere = accountId ? 'WHERE a.account_id = @accountId' : '';
    const attachmentTotals = this.db
      .prepare(
        `SELECT COUNT(*) AS files, COALESCE(SUM(a.size), 0) AS bytes FROM attachments a ${attachmentWhere}`,
      )
      .get(params) as { files: number; bytes: number };

    const byType = this.db
      .prepare(
        `SELECT COALESCE(NULLIF(a.content_type, ''), 'unbekannt') AS type, COUNT(*) AS files,
                COALESCE(SUM(a.size), 0) AS bytes
           FROM attachments a ${attachmentWhere}
          GROUP BY type ORDER BY bytes DESC LIMIT 10`,
      )
      .all(params) as Array<{ type: string; files: number; bytes: number }>;

    const totals = this.db
      .prepare(
        `SELECT COUNT(*) AS messages,
                COALESCE(SUM(CASE WHEN m.linked_to IS NULL THEN m.size ELSE 0 END), 0) AS bytes,
                COALESCE(SUM(CASE WHEN m.linked_to IS NOT NULL THEN 1 ELSE 0 END), 0) AS linked
           ${active}`,
      )
      .get(params) as { messages: number; bytes: number; linked: number };

    const deleted = this.db
      .prepare(
        `SELECT COUNT(*) AS count FROM messages m WHERE m.state = 'deleted' ${where}`,
      )
      .get(params) as { count: number };

    const withAttachments = this.db
      .prepare(
        `SELECT COUNT(DISTINCT a.message_id) AS count FROM attachments a ${attachmentWhere}`,
      )
      .get(params) as { count: number };

    const range = this.db
      .prepare(
        `SELECT MIN(m.internal_date) AS first, MAX(m.internal_date) AS last ${active}`,
      )
      .get(params) as { first: string | null; last: string | null };

    return {
      perYear,
      perFolder,
      topSenders,
      largest,
      attachments: { files: attachmentTotals.files, bytes: attachmentTotals.bytes, byType },
      totals: {
        messages: totals.messages,
        bytes: totals.bytes,
        deleted: deleted.count,
        linked: totals.linked,
        withAttachments: withAttachments.count,
      },
      range,
    };
  }

  recordVerifyRun(run: {
    id: string;
    accountId: string;
    startedAt: string;
    finishedAt: string | null;
    status: string;
    stats: unknown;
    findings: unknown;
    error: string | null;
  }): void {
    this.db
      .prepare(
        `INSERT INTO verify_runs (id, account_id, started_at, finished_at, status, stats, findings, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           finished_at = excluded.finished_at, status = excluded.status,
           stats = excluded.stats, findings = excluded.findings, error = excluded.error`,
      )
      .run(
        run.id,
        run.accountId,
        run.startedAt,
        run.finishedAt,
        run.status,
        JSON.stringify(run.stats),
        JSON.stringify(run.findings),
        run.error,
      );
  }

  lastVerifyRun(accountId: string): Record<string, unknown> | undefined {
    return this.db
      .prepare('SELECT * FROM verify_runs WHERE account_id = ? ORDER BY started_at DESC LIMIT 1')
      .get(accountId) as Record<string, unknown> | undefined;
  }

  updateFlags(id: number, flags: string[]): void {
    this.db.prepare('UPDATE messages SET flags = ? WHERE id = ?').run(JSON.stringify(flags), id);
  }

  /** Records that a message now lives in a different folder. */
  moveMessage(
    id: number,
    target: { folderId: number; uid: number; uidvalidity: number; fileName: string },
  ): void {
    this.db
      .prepare(
        `UPDATE messages
            SET folder_id = ?, uid = ?, uidvalidity = ?, file_name = ?,
                state = 'active', deleted_at = NULL
          WHERE id = ?`,
      )
      .run(target.folderId, target.uid, target.uidvalidity, target.fileName, id);
  }

  markDeleted(id: number, deletedAt = new Date().toISOString()): void {
    this.db
      .prepare("UPDATE messages SET state = 'deleted', deleted_at = ? WHERE id = ?")
      .run(deletedAt, id);
  }

  removeMessage(id: number): void {
    this.db.prepare('DELETE FROM messages WHERE id = ?').run(id);
  }

  listDeletedMessages(accountId: string, olderThanIso?: string): MessageRow[] {
    if (olderThanIso) {
      return this.db
        .prepare(
          "SELECT * FROM messages WHERE account_id = ? AND state = 'deleted' AND deleted_at IS NOT NULL AND deleted_at < ?",
        )
        .all(accountId, olderThanIso) as MessageRow[];
    }
    return this.db
      .prepare("SELECT * FROM messages WHERE account_id = ? AND state = 'deleted'")
      .all(accountId) as MessageRow[];
  }

  // ------------------------------------------------------------ attachments

  /** Every message of an account that is still present locally. */
  listMessagesForExport(
    accountId: string,
    folderIds?: number[],
    range?: { from?: string | null; to?: string | null },
  ): MessageRow[] {
    const where = ["account_id = ?", "state = 'active'"];
    const params: unknown[] = [accountId];

    if (folderIds && folderIds.length > 0) {
      where.push(`folder_id IN (${folderIds.map(() => '?').join(',')})`);
      params.push(...folderIds);
    }
    if (range?.from) {
      where.push('internal_date >= ?');
      params.push(range.from);
    }
    if (range?.to) {
      // Inclusive end of day, as everywhere else a date is entered without a time.
      where.push('internal_date <= ?');
      params.push(`${range.to}T23:59:59.999Z`);
    }

    return this.db
      .prepare(`SELECT * FROM messages WHERE ${where.join(' AND ')} ORDER BY folder_id, uid`)
      .all(...params) as MessageRow[];
  }

  /** Attachments already exported for one message, keyed by name and hash. */
  listAttachmentsForMessage(messageId: number): AttachmentRow[] {
    return this.db
      .prepare('SELECT * FROM attachments WHERE message_id = ?')
      .all(messageId) as AttachmentRow[];
  }

  /** Looks up an identical file that was exported before (de-duplication). */
  findAttachmentByHash(accountId: string, sha256: string): AttachmentRow | undefined {
    return this.db
      .prepare('SELECT * FROM attachments WHERE account_id = ? AND sha256 = ? LIMIT 1')
      .get(accountId, sha256) as AttachmentRow | undefined;
  }

  insertAttachment(attachment: NewAttachment): number {
    const result = this.db
      .prepare(
        `INSERT OR REPLACE INTO attachments (
           account_id, message_id, original_name, content_type, size, sha256,
           inline, export_path, deduplicated, exported_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        attachment.accountId,
        attachment.messageId,
        attachment.originalName,
        attachment.contentType,
        attachment.size,
        attachment.sha256,
        attachment.inline ? 1 : 0,
        attachment.exportPath,
        attachment.deduplicated ? 1 : 0,
        new Date().toISOString(),
      );
    return Number(result.lastInsertRowid);
  }

  listAttachments(accountId: string): AttachmentRow[] {
    return this.db
      .prepare('SELECT * FROM attachments WHERE account_id = ? ORDER BY exported_at')
      .all(accountId) as AttachmentRow[];
  }

  countAttachments(accountId: string): { files: number; bytes: number } {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS files, COALESCE(SUM(CASE WHEN deduplicated = 0 THEN size ELSE 0 END), 0) AS bytes
           FROM attachments WHERE account_id = ?`,
      )
      .get(accountId) as { files: number; bytes: number };
    return row;
  }

  /** Drops the export bookkeeping so the next run starts from scratch. */
  clearAttachments(accountId: string): void {
    this.db.prepare('DELETE FROM attachments WHERE account_id = ?').run(accountId);
  }

  startExportRun(runId: string, accountId: string): void {
    this.db
      .prepare("INSERT INTO export_runs (id, account_id, started_at, status) VALUES (?, ?, ?, 'running')")
      .run(runId, accountId, new Date().toISOString());
  }

  finishExportRun(
    runId: string,
    status: 'done' | 'cancelled' | 'failed',
    stats: unknown,
    error?: string,
  ): void {
    this.db
      .prepare('UPDATE export_runs SET finished_at = ?, status = ?, stats = ?, error = ? WHERE id = ?')
      .run(new Date().toISOString(), status, JSON.stringify(stats), error ?? null, runId);
  }

  listExportRuns(accountId: string, limit = 10): Array<Record<string, unknown>> {
    return this.db
      .prepare('SELECT * FROM export_runs WHERE account_id = ? ORDER BY started_at DESC LIMIT ?')
      .all(accountId, limit) as Array<Record<string, unknown>>;
  }

  // ------------------------------------------------------------ full text

  /** Message ids of an account that have no text index entry yet. */
  listUnindexedMessages(accountId: string, limit?: number): MessageRow[] {
    const sql = `SELECT m.* FROM messages m
                  LEFT JOIN message_text t ON t.message_id = m.id
                  WHERE m.account_id = ? AND m.state = 'active' AND t.message_id IS NULL
                  ORDER BY m.folder_id, m.uid${limit ? ' LIMIT ?' : ''}`;
    return (limit
      ? this.db.prepare(sql).all(accountId, limit)
      : this.db.prepare(sql).all(accountId)) as MessageRow[];
  }

  upsertMessageText(entry: {
    messageId: number;
    accountId: string;
    subject: string | null;
    fromAddr: string | null;
    toAddr: string | null;
    body: string;
    attachmentText: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO message_text
           (message_id, account_id, subject, from_addr, to_addr, body, attachment_text, indexed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (message_id) DO UPDATE SET
           subject = excluded.subject,
           from_addr = excluded.from_addr,
           to_addr = excluded.to_addr,
           body = excluded.body,
           attachment_text = excluded.attachment_text,
           indexed_at = excluded.indexed_at`,
      )
      .run(
        entry.messageId,
        entry.accountId,
        entry.subject,
        entry.fromAddr,
        entry.toAddr,
        entry.body,
        entry.attachmentText,
        new Date().toISOString(),
      );
  }

  countIndexed(accountId: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS count FROM message_text WHERE account_id = ?')
      .get(accountId) as { count: number };
    return row.count;
  }

  clearIndex(accountId: string): void {
    this.db.prepare('DELETE FROM message_text WHERE account_id = ?').run(accountId);
  }

  startIndexRun(runId: string, accountId: string): void {
    this.db
      .prepare("INSERT INTO index_runs (id, account_id, started_at, status) VALUES (?, ?, ?, 'running')")
      .run(runId, accountId, new Date().toISOString());
  }

  finishIndexRun(
    runId: string,
    status: 'done' | 'cancelled' | 'failed',
    stats: unknown,
    error?: string,
  ): void {
    this.db
      .prepare('UPDATE index_runs SET finished_at = ?, status = ?, stats = ?, error = ? WHERE id = ?')
      .run(new Date().toISOString(), status, JSON.stringify(stats), error ?? null, runId);
  }

  // -------------------------------------------------------------- sync runs

  startRun(runId: string, accountId: string): void {
    this.db
      .prepare("INSERT INTO sync_runs (id, account_id, started_at, status) VALUES (?, ?, ?, 'running')")
      .run(runId, accountId, new Date().toISOString());
  }

  finishRun(runId: string, status: 'done' | 'cancelled' | 'failed', stats: SyncStats, error?: string): void {
    this.db
      .prepare('UPDATE sync_runs SET finished_at = ?, status = ?, stats = ?, error = ? WHERE id = ?')
      .run(new Date().toISOString(), status, JSON.stringify(stats), error ?? null, runId);
  }

  listRuns(accountId: string, limit = 25): Array<Record<string, unknown>> {
    return this.db
      .prepare('SELECT * FROM sync_runs WHERE account_id = ? ORDER BY started_at DESC LIMIT ?')
      .all(accountId, limit) as Array<Record<string, unknown>>;
  }

  /** The most recent runs across all accounts, newest first. */
  listRecentRuns(limit = 10): Array<Record<string, unknown>> {
    return this.db
      .prepare('SELECT * FROM sync_runs ORDER BY started_at DESC LIMIT ?')
      .all(limit) as Array<Record<string, unknown>>;
  }

  /** Drops every trace of an account from the index. */
  deleteAccountData(accountId: string): void {
    this.transaction(() => {
      this.db.prepare('DELETE FROM message_text WHERE account_id = ?').run(accountId);
      this.db.prepare('DELETE FROM index_runs WHERE account_id = ?').run(accountId);
      this.db.prepare('DELETE FROM attachments WHERE account_id = ?').run(accountId);
      this.db.prepare('DELETE FROM export_runs WHERE account_id = ?').run(accountId);
      this.db.prepare('DELETE FROM messages WHERE account_id = ?').run(accountId);
      this.db.prepare('DELETE FROM folders WHERE account_id = ?').run(accountId);
      this.db.prepare('DELETE FROM sync_runs WHERE account_id = ?').run(accountId);
    });
  }
}

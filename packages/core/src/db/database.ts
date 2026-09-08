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
  state: 'active' | 'deleted';
  deleted_at: string | null;
  created_at: string;
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
  totalBytes(accountId: string): number {
    const row = this.db
      .prepare("SELECT COALESCE(SUM(size), 0) AS bytes FROM messages WHERE account_id = ? AND state = 'active'")
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
           size, subject, from_addr, to_addr, flags, file_name, state, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
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
        new Date().toISOString(),
      );
    return Number(result.lastInsertRowid);
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
      this.db.prepare('DELETE FROM messages WHERE account_id = ?').run(accountId);
      this.db.prepare('DELETE FROM folders WHERE account_id = ?').run(accountId);
      this.db.prepare('DELETE FROM sync_runs WHERE account_id = ?').run(accountId);
    });
  }
}

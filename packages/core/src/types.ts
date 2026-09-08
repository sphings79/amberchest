/**
 * Shared domain types for Mail Archiver.
 *
 * These types are used by the core engine, the HTTP API and the web frontend.
 */

export type ConnectionSecurity = 'tls' | 'starttls' | 'none';

/** What happens locally when a message disappears from the server. */
export type DeletedHandling =
  /** Keep the local copy where it is; the archive only ever grows. */
  | 'keep'
  /** Move the local copy into the `_deleted` tree so it can be purged later. */
  | 'move-to-deleted'
  /** Delete the local copy immediately (true mirror of the server). */
  | 'mirror';

export interface AccountSettings {
  /** Number of parallel IMAP connections used for one account. */
  concurrency: number;
  /** How many messages are fetched per FETCH batch. */
  batchSize: number;
  /** Artificial pause between batches, for servers that throttle aggressively. */
  requestDelayMs: number;
  /** Only archive messages whose internal date is at or after this ISO date. */
  sinceDate: string | null;
  deletedHandling: DeletedHandling;
  /** Purge `_deleted` entries older than this many days; null disables it. */
  deletedRetentionDays: number | null;
  /** Newly appeared server folders are selected automatically when true. */
  autoSelectNewFolders: boolean;
}

export interface Account {
  id: string;
  /** Display name shown in the UI. */
  name: string;
  email: string;
  host: string;
  port: number;
  security: ConnectionSecurity;
  /** Set to false to accept self-signed certificates. */
  rejectUnauthorized: boolean;
  username: string;
  /** Only ever present in the decrypted configuration. */
  password: string;
  /** Absolute path overriding the global archive directory. */
  archivePath: string | null;
  /** IMAP paths (server notation) selected for archiving. */
  selectedFolders: string[];
  settings: AccountSettings;
  createdAt: string;
  updatedAt: string;
}

/** Account without the password, safe to send to the frontend. */
export type PublicAccount = Omit<Account, 'password'> & { hasPassword: boolean };

export type ThemeMode = 'light' | 'dark' | 'system';

export interface AppSettings {
  /** Base directory holding one subdirectory per account. */
  archivePath: string;
  language: 'de' | 'en';
  theme: ThemeMode;
  accentColor: string;
}

export interface AppConfig {
  version: number;
  settings: AppSettings;
  accounts: Account[];
}

/** A folder as reported by the IMAP server. */
export interface RemoteFolder {
  /** Server path, e.g. `INBOX.Projekte` — used for all IMAP operations. */
  path: string;
  /** Last path segment, decoded. */
  name: string;
  /** Hierarchy delimiter reported by the server. */
  delimiter: string;
  /** RFC 6154 special use attribute such as `\Sent`, if advertised. */
  specialUse: string | null;
  /** True when the folder cannot hold messages. */
  noSelect: boolean;
  /** Number of messages, when the server reported it. */
  messageCount: number | null;
  /** Total size in bytes, when the server reported it (rare). */
  sizeBytes: number | null;
}

/** A folder enriched with local state for the selection screen. */
export interface FolderTreeNode extends RemoteFolder {
  /** Present in the archive from an earlier run. */
  known: boolean;
  /** Appeared on the server since the last run — highlighted in the UI. */
  isNew: boolean;
  selected: boolean;
  /** Locally archived message count. */
  localMessageCount: number;
  children: FolderTreeNode[];
}

export interface SyncStats {
  foldersTotal: number;
  foldersDone: number;
  messagesNew: number;
  messagesMoved: number;
  messagesDeleted: number;
  messagesRestored: number;
  flagsUpdated: number;
  bytesDownloaded: number;
}

export type SyncPhase =
  | 'connecting'
  | 'listing-folders'
  | 'scanning'
  | 'matching'
  | 'downloading'
  | 'finalizing'
  | 'done'
  | 'cancelled'
  | 'failed';

export interface SyncProgress {
  runId: string;
  accountId: string;
  phase: SyncPhase;
  /** Folder currently being processed (server path). */
  currentFolder: string | null;
  /** Progress within the current folder. */
  folderMessagesDone: number;
  folderMessagesTotal: number;
  stats: SyncStats;
  startedAt: string;
  error?: string;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  ts: string;
  level: LogLevel;
  accountId: string | null;
  message: string;
  detail?: string;
}

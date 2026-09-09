/**
 * Shared domain types for AmberChest.
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
  /** Aliases beside the account address, for "sent to myself". */
  ownAddresses: string[];
  /**
   * Store a message once when it sits in several folders.
   *
   * Gmail shows every mail in its folder and in All Mail; without this the
   * archive holds it twice.
   */
  linkDuplicates: boolean;
  /**
   * Never remove anything older than this date, whatever the server does.
   *
   * For emptying a mailbox to win back space while the archive keeps it.
   */
  protectBeforeDate: string | null;
}

/** Where exported attachments are laid out inside the target directory. */
export type AttachmentLayout =
  /** Mirrors the mail folder tree. */
  | 'folder-tree'
  /** Everything in one directory. */
  | 'flat'
  /** Sorted into <year>/<month> by message date. */
  | 'year-month'
  /** One directory per message, named after date and UID. */
  | 'per-message';

export type ExtensionFilterMode = 'all' | 'include' | 'exclude';

export interface AttachmentSettings {
  /** Absolute target directory; null puts them next to the account archive. */
  targetPath: string | null;
  layout: AttachmentLayout;
  /** Export images and other parts embedded in the message body as well. */
  includeInline: boolean;
  /** Parts smaller than this are skipped; 0 disables the filter. */
  minSizeBytes: number;
  extensionMode: ExtensionFilterMode;
  /** Extensions without the dot, lower case. */
  extensions: string[];
  /** Write identical files only once and point the manifest at the first copy. */
  deduplicate: boolean;
  /** Write attachments.csv and attachments.json into the target directory. */
  writeManifest: boolean;
  /** IMAP paths to export from; empty means every archived folder. */
  folders: string[];
  /**
   * Only messages in this range, by the date the server has for them.
   *
   * Either end may stand alone: "everything since the move" needs no upper
   * bound, "everything before the old job" needs no lower one.
   */
  dateFrom: string | null;
  dateTo: string | null;
}

export interface AccountOAuth {
  provider: 'google' | 'microsoft' | 'custom';
  refreshToken: string;
  accessToken: string;
  /** Epoch milliseconds. */
  expiresAt: number;
  scope: string;
}

/** One registered client per provider, shared by every mailbox that uses it. */
export interface OAuthClient {
  clientId: string;
  clientSecret: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  deviceEndpoint: string;
  scopes: string[];
  imapHost: string;
}

export interface OAuthSettings {
  google: OAuthClient;
  microsoft: OAuthClient;
  custom: OAuthClient;
  /** Loopback works without a reachable address; public needs one. */
  redirectMode: 'loopback' | 'public';
  publicRedirectUri: string;
}

/** What the interface may see of an OAuth connection: no secrets. */
export interface PublicAccountOAuth {
  provider: 'google' | 'microsoft' | 'custom';
  scope: string;
  expiresAt: number;
  /** True once a refresh token is stored, so backups can run unattended. */
  connected: boolean;
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
  /** A password account keeps its password; an OAuth account keeps tokens. */
  authType: 'password' | 'oauth';
  oauth: AccountOAuth | null;
  /** Absolute path overriding the global archive directory. */
  archivePath: string | null;
  /** IMAP paths (server notation) selected for archiving. */
  selectedFolders: string[];
  settings: AccountSettings;
  attachments: AttachmentSettings;
  createdAt: string;
  updatedAt: string;
}

/** Account without the password, safe to send to the frontend. */
export type PublicAccount = Omit<Account, 'password' | 'oauth'> & {
  hasPassword: boolean;
  oauth: PublicAccountOAuth | null;
};

export type ThemeMode = 'light' | 'dark' | 'system';

export interface SearchSettings {
  /** Read text out of PDF and Office attachments while indexing. */
  indexAttachments: boolean;
  /** Attachments above this size are not opened; 0 disables the limit. */
  maxAttachmentBytes: number;
  /** Index new messages automatically after a backup run. */
  autoIndex: boolean;
}

export interface McpSettings {
  /** Master switch; nothing is exposed while this is off. */
  enabled: boolean;
  /** Also answer MCP over HTTP, not just over stdio. */
  httpEnabled: boolean;
  /** Bearer token for the HTTP transport; generated when empty. */
  token: string;
  permissions: {
    read: boolean;
    backup: boolean;
    export: boolean;
    accountsWrite: boolean;
    settingsWrite: boolean;
    delete: boolean;
  };
}

export interface MqttSettings {
  /** Master switch; nothing is published while this is off. */
  enabled: boolean;
  /** Broker address, for example mqtt://192.168.1.10:1883. */
  url: string;
  username: string;
  password: string;
  /** Empty lets the client pick one. */
  clientId: string;
  /** Everything is published below this topic. */
  baseTopic: string;
  /** Publish the Home Assistant discovery messages. */
  discovery: boolean;
  discoveryPrefix: string;
  /** Retained messages survive a restart of Home Assistant. */
  retain: boolean;
  /** Off means the bridge only reports and never accepts a command. */
  allowCommands: boolean;
  publishIntervalSeconds: number;
  rejectUnauthorized: boolean;
}

export interface StorageSettings {
  /** Warn below this many gigabytes free; zero switches it off. */
  warnBelowGb: number;
  /** Stop a running backup below this many gigabytes free. */
  stopBelowGb: number;
}

export interface NotificationSettings {
  enabled: boolean;
  url: string;
  format: 'json' | 'ntfy' | 'gotify' | 'discord' | 'apprise';
  authHeader: string;
  events: {
    backupFailed: boolean;
    backupFinished: boolean;
    verifyProblems: boolean;
    lowDiskSpace: boolean;
  };
}

export interface AppSettings {
  /** Base directory holding one subdirectory per account. */
  archivePath: string;
  language: 'de' | 'en';
  theme: ThemeMode;
  accentColor: string;
  search: SearchSettings;
  mcp: McpSettings;
  mqtt: MqttSettings;
  oauth: OAuthSettings;
  storage: StorageSettings;
  notifications: NotificationSettings;
  /**
   * Encrypt the .eml files in the archive. Off by default: encrypted files can
   * no longer be opened by a mail client directly.
   */
  encryptArchive: boolean;
}

/**
 * What the settings look like once the secrets are gone.
 *
 * Every credential becomes a flag: enough to render "a token is set" without
 * handing the token itself to whoever asked. Produced by toPublicSettings.
 */
export type PublicOAuthClient = Omit<OAuthClient, 'clientSecret'> & { hasClientSecret: boolean };

export interface PublicSettings
  extends Omit<AppSettings, 'mcp' | 'mqtt' | 'notifications' | 'oauth'> {
  mcp: Omit<McpSettings, 'token'> & { hasToken: boolean };
  mqtt: Omit<MqttSettings, 'password'> & { hasPassword: boolean };
  notifications: Omit<NotificationSettings, 'authHeader'> & { hasAuthHeader: boolean };
  oauth: Omit<OAuthSettings, 'google' | 'microsoft' | 'custom'> & {
    google: PublicOAuthClient;
    microsoft: PublicOAuthClient;
    custom: PublicOAuthClient;
  };
}

/**
 * The settings as the authenticated interface gets them.
 *
 * A step short of PublicSettings: the operator is allowed to read the MCP
 * token back, because the interface shows it to be copied into a client
 * configuration. The broker password, the notification header and the client
 * secrets are only ever typed in, never read back, so they are not sent.
 */
export interface OperatorSettings extends Omit<PublicSettings, 'mcp'> {
  mcp: McpSettings;
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
  /** Stored once although they sit in several folders; Gmail does this. */
  messagesLinked: number;
  /** Gone from the server, kept because they are older than the set date. */
  messagesProtected: number;
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

export interface ExportStats {
  messagesTotal: number;
  messagesDone: number;
  attachmentsFound: number;
  attachmentsWritten: number;
  attachmentsFiltered: number;
  attachmentsDeduplicated: number;
  attachmentsSkipped: number;
  bytesWritten: number;
}

export type ExportPhase = 'scanning' | 'exporting' | 'manifest' | 'done' | 'cancelled' | 'failed';

export interface ExportProgress {
  runId: string;
  accountId: string;
  phase: ExportPhase;
  currentFolder: string | null;
  stats: ExportStats;
  startedAt: string;
  targetPath: string;
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

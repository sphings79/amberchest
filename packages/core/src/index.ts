export * from './types.js';
export { MailArchiverApp, type AccountOverview } from './app.js';
export { ConfigStore, ConfigLockedError, toPublicAccount } from './config/store.js';
export { WrongPasswordError } from './config/crypto.js';
export {
  accountInputSchema,
  accountSettingsSchema,
  appSettingsSchema,
  attachmentSettingsSchema,
  mcpSettingsSchema,
  searchSettingsSchema,
  defaultAccountSettings,
  defaultAttachmentSettings,
  type AccountInput,
} from './config/schema.js';
export { configDir, configFilePath, databaseFilePath, defaultArchiveDir } from './config/locations.js';
export {
  ArchiveDatabase,
  type AttachmentRow,
  type FolderRow,
  type MessageRow,
} from './db/database.js';
export {
  connectionOptionsFromAccount,
  describeImapError,
  testConnection,
  type ConnectionTestResult,
  type ImapConnectionOptions,
} from './imap/client.js';
export { AttachmentExportEngine, ExportCancelledError } from './attachments/engine.js';
export { AttachmentExportManager } from './attachments/manager.js';
export { extractAttachments, extensionOf, type ExtractedAttachment } from './attachments/extract.js';
export { SearchIndexEngine, IndexCancelledError, type IndexProgress, type IndexStats } from './search/indexer.js';
export { SearchIndexManager } from './search/manager.js';
export {
  searchMessages,
  type SearchHit,
  type SearchOptions,
  type SearchResult,
} from './search/search.js';
export { toMatchExpression } from './search/query.js';
export { foldGerman, foldedVariants, withFoldedVariants } from './search/fold.js';
export { extractText, isExtractable } from './search/text.js';
export {
  loadMessage,
  loadAttachment,
  loadMessageSource,
  type MessageContent,
  type MessageAttachmentInfo,
} from './search/message.js';
export {
  BundleEngine,
  BundleCancelledError,
  MAX_BUNDLE_MESSAGES,
  purgeOldBundles,
  type BundleFormat,
  type BundleProgress,
  type BundleStats,
} from './export/bundle.js';
export { BundleManager, type FinishedBundle } from './export/manager.js';
export { MboxWriter, toMboxEntry } from './export/mbox.js';
export { ZipWriter } from './export/zip.js';
export {
  chromiumPdfRenderer,
  isPdfAvailable,
  messageToPrintableHtml,
  type PdfRenderer,
} from './export/pdf.js';
export {
  McpServer,
  handleRawMessage,
  SUPPORTED_PROTOCOL_VERSIONS,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from './mcp/protocol.js';
export {
  TOOLS,
  MCP_PERMISSIONS,
  availableTools,
  callTool,
  type McpPermission,
  type McpPermissions,
  type ToolDefinition,
} from './mcp/tools.js';
export {
  RestoreEngine,
  RestoreCancelledError,
  suggestMappings,
  type FolderMapping,
  type RestoreProgress,
  type RestoreStats,
} from './restore/engine.js';
export { RestoreManager } from './restore/manager.js';
export {
  parseCron,
  matches as cronMatches,
  nextRun as cronNextRun,
  isValidCron,
  CronParseError,
  type CronFields,
} from './schedule/cron.js';
export { Scheduler } from './schedule/scheduler.js';
export { SyncEngine, SyncCancelledError } from './sync/engine.js';
export { SyncManager } from './sync/manager.js';
export { buildFolderTree, collectSelected, suggestSelection } from './sync/folders.js';
export { ArchiveLayout } from './storage/archive.js';
export { readJournal, type JournalRecord } from './storage/journal.js';
export { logger, Logger } from './util/logger.js';
export {
  DELETED_DIR,
  JOURNAL_FILE,
  folderPathSegments,
  messageFileName,
  sanitizeSegment,
  uniqueFileName,
} from './util/paths.js';
export { messageFingerprint, sha256 } from './util/hash.js';

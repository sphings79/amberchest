export * from './types.js';
export { MailArchiverApp, type AccountOverview } from './app.js';
export { ConfigStore, ConfigLockedError, toPublicAccount } from './config/store.js';
export { WrongPasswordError } from './config/crypto.js';
export {
  accountInputSchema,
  accountSettingsSchema,
  appSettingsSchema,
  attachmentSettingsSchema,
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

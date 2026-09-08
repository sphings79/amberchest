import { ConfigStore, toPublicAccount } from './config/store.js';
import type { AccountInput } from './config/schema.js';
import { ArchiveDatabase } from './db/database.js';
import {
  connectionOptionsFromAccount,
  listRemoteFolders,
  testConnection,
  withConnection,
  type ConnectionTestResult,
  type ImapConnectionOptions,
} from './imap/client.js';
import { AttachmentExportManager } from './attachments/manager.js';
import { buildFolderTree } from './sync/folders.js';
import { SyncManager } from './sync/manager.js';
import type {
  Account,
  AppSettings,
  AttachmentSettings,
  ExportProgress,
  FolderTreeNode,
  PublicAccount,
  SyncProgress,
} from './types.js';
import { logger } from './util/logger.js';

export interface AccountOverview {
  account: PublicAccount;
  messageCount: number;
  /** Messages sitting in the _deleted tree. */
  deletedCount: number;
  folderCount: number;
  /** Summed size of the archived messages in bytes. */
  bytes: number;
  lastRun: Record<string, unknown> | null;
  running: boolean;
  progress: SyncProgress | null;
  /** Files written by the attachment export, and their size. */
  attachmentCount: number;
  attachmentBytes: number;
  exportRunning: boolean;
  exportProgress: ExportProgress | null;
  lastExportRun: Record<string, unknown> | null;
}

/**
 * Everything the HTTP layer needs, in one object.
 *
 * The desktop app and the container both create exactly one of these; the only
 * difference is where the master password comes from.
 */
export class MailArchiverApp {
  readonly config: ConfigStore;
  readonly db: ArchiveDatabase;
  readonly sync: SyncManager;
  readonly exports: AttachmentExportManager;

  constructor(options: { configPath?: string; databasePath?: string } = {}) {
    this.config = new ConfigStore(options.configPath);
    this.db = new ArchiveDatabase(options.databasePath);
    this.sync = new SyncManager({
      db: this.db,
      archiveBaseDir: () => this.config.getSettings().archivePath,
    });
    this.exports = new AttachmentExportManager({
      db: this.db,
      archiveBaseDir: () => this.config.getSettings().archivePath,
    });
  }

  get isInitialized(): boolean {
    return this.config.isInitialized;
  }

  get isUnlocked(): boolean {
    return this.config.isUnlocked;
  }

  async initialize(masterPassword: string): Promise<void> {
    await this.config.initialize(masterPassword);
    logger.info('Created a new configuration');
  }

  async unlock(masterPassword: string): Promise<void> {
    await this.config.unlock(masterPassword);
    logger.info('Configuration unlocked');
  }

  lock(): void {
    this.config.lock();
  }

  getSettings(): AppSettings {
    return this.config.getSettings();
  }

  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    return this.config.updateSettings(patch);
  }

  listAccounts(): PublicAccount[] {
    return this.config.listPublicAccounts();
  }

  overview(): AccountOverview[] {
    return this.config.listAccounts().map((account) => {
      const runs = this.db.listRuns(account.id, 1);
      const exportRuns = this.db.listExportRuns(account.id, 1);
      const attachments = this.db.countAttachments(account.id);
      return {
        account: toPublicAccount(account),
        messageCount: this.db.countMessagesByAccount(account.id),
        deletedCount: this.db.countDeletedMessages(account.id),
        folderCount: this.db.listFolders(account.id).length,
        bytes: this.db.totalBytes(account.id),
        lastRun: runs[0] ?? null,
        running: this.sync.isRunning(account.id),
        progress: this.sync.getProgress(account.id) ?? null,
        attachmentCount: attachments.files,
        attachmentBytes: attachments.bytes,
        exportRunning: this.exports.isRunning(account.id),
        exportProgress: this.exports.getProgress(account.id) ?? null,
        lastExportRun: exportRuns[0] ?? null,
      };
    });
  }

  async addAccount(input: AccountInput): Promise<PublicAccount> {
    return toPublicAccount(await this.config.addAccount(input));
  }

  async updateAccount(id: string, input: Partial<AccountInput>): Promise<PublicAccount> {
    return toPublicAccount(await this.config.updateAccount(id, input));
  }

  async deleteAccount(id: string): Promise<void> {
    await this.config.deleteAccount(id);
    this.db.deleteAccountData(id);
  }

  requireAccount(id: string): Account {
    const account = this.config.getAccount(id);
    if (!account) throw new Error(`Unknown account ${id}`);
    return account;
  }

  testConnection(options: ImapConnectionOptions): Promise<ConnectionTestResult> {
    return testConnection(options);
  }

  /** Connects, lists the folders and merges them with the local state. */
  async getFolderTree(accountId: string, withCounts = false): Promise<FolderTreeNode[]> {
    const account = this.requireAccount(accountId);
    const remoteFolders = await withConnection(connectionOptionsFromAccount(account), (client) =>
      listRemoteFolders(client, { withCounts }),
    );
    return buildFolderTree({ account, db: this.db, remoteFolders });
  }

  async setSelectedFolders(accountId: string, folders: string[]): Promise<void> {
    await this.config.setSelectedFolders(accountId, folders);
    this.db.setSelectedFolders(accountId, folders);
  }

  getAttachmentSettings(accountId: string): AttachmentSettings {
    return { ...this.requireAccount(accountId).attachments };
  }

  updateAttachmentSettings(
    accountId: string,
    patch: Partial<AttachmentSettings>,
  ): Promise<AttachmentSettings> {
    return this.config.updateAttachmentSettings(accountId, patch);
  }

  startAttachmentExport(accountId: string): Promise<ExportProgress | undefined> {
    return this.exports.start(this.requireAccount(accountId));
  }

  cancelAttachmentExport(accountId: string): boolean {
    return this.exports.cancel(accountId);
  }

  /** Forgets which attachments were exported, so the next run redoes them. */
  resetAttachmentExport(accountId: string): void {
    this.db.clearAttachments(accountId);
  }

  startSync(accountId: string): Promise<SyncProgress | undefined> {
    return this.sync.start(this.requireAccount(accountId));
  }

  cancelSync(accountId: string): boolean {
    return this.sync.cancel(accountId);
  }

  close(): void {
    this.db.close();
  }
}

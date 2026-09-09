import { ConfigStore, toPublicAccount } from './config/store.js';
import { discardFolder, type DiscardResult } from './storage/discard.js';
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
import { BundleManager } from './export/manager.js';
import {
  chromiumPdfRenderer,
  isPdfAvailable,
  messageToPrintableHtml,
  type PdfRenderer,
} from './export/pdf.js';
import type { BundleFormat } from './export/bundle.js';
import {
  loadAttachment,
  loadMessage,
  loadMessageSource,
  type LoadedAttachment,
  type MessageContent,
} from './search/message.js';
import { SearchIndexManager } from './search/manager.js';
import { searchMessages, type SearchOptions, type SearchResult } from './search/search.js';
import { McpServer } from './mcp/protocol.js';
import { MqttBridge, type MqttStatus } from './mqtt/bridge.js';
import { AdoptManager } from './adopt/manager.js';
import { TransferManager } from './transfer/manager.js';
import type { TransferProgress, TransferTarget } from './transfer/engine.js';
import type { AdoptProgress } from './adopt/engine.js';
import { Notifier } from './notify/notifier.js';
import { writeRegister, type RegisterResult } from './register/writer.js';
import { OAuthManager } from './oauth/manager.js';
import { diskSpace, type DiskSpace } from './storage/disk.js';
import { VerifyManager } from './verify/manager.js';
import type { VerifyProgress } from './verify/engine.js';
import { RestoreManager } from './restore/manager.js';
import { EncryptionMigrationManager, type MigrationProgress } from './storage/migrate.js';
import { ArchiveLayout, listArchiveFiles, writeArchiveFile } from './storage/archive.js';
import { suggestMappings, type FolderMapping, type RestoreProgress } from './restore/engine.js';
import type { McpPermissions } from './mcp/tools.js';
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
  /** Messages that carry a full text index entry. */
  indexedCount: number;
  indexRunning: boolean;
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
export class AmberChestApp {
  readonly config: ConfigStore;
  readonly db: ArchiveDatabase;
  readonly sync: SyncManager;
  readonly exports: AttachmentExportManager;
  readonly index: SearchIndexManager;
  readonly bundles: BundleManager;
  readonly restore = new RestoreManager();
  readonly migration = new EncryptionMigrationManager();
  readonly mqtt: MqttBridge;
  readonly oauth: OAuthManager;
  readonly verify: VerifyManager;
  readonly notifier: Notifier;
  readonly adopt: AdoptManager;
  readonly transfer: TransferManager;
  private readonly pdfRenderer: PdfRenderer | undefined;
  private schedule: { expression: string; nextRun: () => Date | null } | null = null;

  constructor(
    options: {
      configPath?: string;
      databasePath?: string;
      /** Desktop apps inject Electron's printToPDF here. */
      pdfRenderer?: PdfRenderer;
    } = {},
  ) {
    this.config = new ConfigStore(options.configPath);
    this.db = new ArchiveDatabase(options.databasePath);
    this.pdfRenderer = options.pdfRenderer;
    this.sync = new SyncManager({
      db: this.db,
      archiveBaseDir: () => this.config.getSettings().archivePath,
      // Only set when the user asked for an encrypted archive; reading works
      // either way, because each file says what it is.
      encryptionKey: () => (this.config.getSettings().encryptArchive ? this.config.archiveKey : null),
      connectionFor: (account) => this.connectionFor(account),
      stopBelowBytes: () => this.config.getSettings().storage.stopBelowGb * 1024 * 1024 * 1024,
    });
    this.exports = new AttachmentExportManager({
      db: this.db,
      archiveBaseDir: () => this.config.getSettings().archivePath,
      encryptionKey: () => this.config.archiveKey,
    });
    this.index = new SearchIndexManager({
      db: this.db,
      archiveBaseDir: () => this.config.getSettings().archivePath,
      encryptionKey: () => this.config.archiveKey,
    });
    this.bundles = new BundleManager({
      db: this.db,
      archiveBaseDir: () => this.config.getSettings().archivePath,
      encryptionKey: () => this.config.archiveKey,
      resolveAccount: (accountId) => this.requireAccount(accountId),
      // Falls back to a Chromium found on the system, which is how the
      // container renders PDFs.
      pdfRenderer: options.pdfRenderer ?? chromiumPdfRenderer,
    });
    this.oauth = new OAuthManager(this.config);
    this.verify = new VerifyManager({
      db: this.db,
      archiveBaseDir: () => this.config.getSettings().archivePath,
      encryptionKey: () => this.config.archiveKey,
      connectionFor: (account) => this.connectionFor(account),
    });
    this.notifier = new Notifier(() => this.config.getSettings().notifications);
    this.transfer = new TransferManager({
      archiveBaseDir: () => this.config.getSettings().archivePath,
    });
    this.adopt = new AdoptManager({
      db: this.db,
      archiveBaseDir: () => this.config.getSettings().archivePath,
      encryptionKey: () => this.config.archiveKey,
      connectionFor: (account) => this.connectionFor(account),
    });
    this.mqtt = new MqttBridge({
      settings: () => this.config.getSettings().mqtt,
      overview: () => this.overview(),
      startSync: (accountId) => this.startSyncAndIndex(accountId),
      cancelSync: (accountId) => this.cancelSync(accountId),
    });
    // A backup changes what the sensors show, so every progress event is
    // pushed straight through instead of waiting for the next interval.
    this.sync.on('progress', (progress: SyncProgress) => {
      void this.mqtt.publishAccount(progress.accountId).catch(() => undefined);
      void this.notifyAboutSync(progress);
    });

    this.verify.on('progress', (progress: VerifyProgress) => {
      if (progress.phase === 'done') void this.notifyAboutVerify(progress);
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
    // The broker credentials live in the encrypted configuration, so the
    // bridge can only start once that is open.
    await this.mqtt.apply();
  }

  lock(): void {
    void this.mqtt.stop();
    this.config.lock();
  }

  getSettings(): AppSettings {
    return this.config.getSettings();
  }

  async updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    const before = this.config.getSettings().mqtt;
    const settings = await this.config.updateSettings(patch);
    // Reconnecting on every settings change would drop the connection when
    // only the theme was touched.
    if (JSON.stringify(before) !== JSON.stringify(settings.mqtt)) await this.mqtt.apply();
    return settings;
  }

  mqttStatus(): MqttStatus {
    return this.mqtt.status;
  }

  /** The container hands in its schedule; the desktop app has none. */
  setSchedule(expression: string, nextRun: () => Date | null): void {
    this.schedule = { expression, nextRun };
    this.mqtt.setNextRunProvider(nextRun);
  }

  scheduleInfo(): { expression: string | null; nextRun: string | null } {
    if (!this.schedule) return { expression: null, nextRun: null };
    return {
      expression: this.schedule.expression,
      nextRun: this.schedule.nextRun()?.toISOString() ?? null,
    };
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
        indexedCount: this.db.countIndexed(account.id),
        indexRunning: this.index.isRunning(account.id),
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

  /**
   * Connection options for an account, with a fresh token when it needs one.
   *
   * Every path to the server goes through here, so a token that expired
   * overnight is renewed before the nightly backup rather than failing it.
   */
  async connectionFor(account: Account): Promise<ImapConnectionOptions> {
    const options = connectionOptionsFromAccount(account);
    if (account.authType !== 'oauth') return options;
    return { ...options, accessToken: await this.oauth.accessToken(account) };
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
    const remoteFolders = await withConnection(await this.connectionFor(account), (client) =>
      listRemoteFolders(client, { withCounts }),
    );
    return buildFolderTree({ account, db: this.db, remoteFolders });
  }

  /**
   * The folders that exist in the archive, for browsing.
   *
   * Unlike getFolderTree this never touches the mail server: it reads what was
   * archived, which is what the browser shows.
   */
  localFolders(accountId: string): Array<{
    path: string;
    name: string;
    delimiter: string;
    specialUse: string | null;
    messages: number;
    lastSync: string | null;
  }> {
    return this.db.listFolders(accountId).map((folder) => {
      const delimiter = folder.delimiter || '/';
      const name = delimiter ? (folder.path.split(delimiter).pop() ?? folder.path) : folder.path;
      return {
        path: folder.path,
        name,
        delimiter,
        specialUse: folder.special_use,
        messages: this.db.countMessages(folder.id),
        lastSync: folder.last_sync,
      };
    });
  }

  async setSelectedFolders(accountId: string, folders: string[]): Promise<void> {
    await this.config.setSelectedFolders(accountId, folders);
    this.db.setSelectedFolders(accountId, folders);
  }

  /**
   * Throws away the local copy of one folder.
   *
   * Nothing happens on the server, so the folder comes back with the next
   * backup unless it is taken out of the selection - which is what `deselect`
   * is for, and what makes this mean anything for a folder somebody wants
   * gone for good.
   */
  async discardFolder(
    accountId: string,
    path: string,
    deselect: boolean,
  ): Promise<DiscardResult & { deselected: boolean }> {
    const account = this.requireAccount(accountId);
    const folder = this.db.listFolders(accountId).find((entry) => entry.path === path);
    if (!folder) throw new Error(`No archived folder ${path}`);

    const result = await discardFolder(this.db, account, folder, this.config.getSettings().archivePath);

    let deselected = false;
    if (deselect) {
      const selected = account.selectedFolders.filter((entry) => entry !== path);
      if (selected.length !== account.selectedFolders.length) {
        await this.setSelectedFolders(accountId, selected);
        deselected = true;
      }
    }
    return { ...result, deselected };
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

  /**
   * Runs the attachment export.
   *
   * `folders` overrides the stored selection for this run alone, which is how
   * the folder tree offers "export the attachments of this folder" without
   * changing what the account is set to do next time.
   */
  startAttachmentExport(accountId: string, folders?: string[]): Promise<ExportProgress | undefined> {
    const account = this.requireAccount(accountId);
    if (!folders) return this.exports.start(account);
    return this.exports.start({
      ...account,
      attachments: { ...account.attachments, folders },
    });
  }

  cancelAttachmentExport(accountId: string): boolean {
    return this.exports.cancel(accountId);
  }

  /** Forgets which attachments were exported, so the next run redoes them. */
  resetAttachmentExport(accountId: string): void {
    this.db.clearAttachments(accountId);
  }

  // ----------------------------------------------------------- search

  search(options: SearchOptions): SearchResult {
    return searchMessages(this.db, options);
  }

  loadMessage(accountId: string, messageId: number): Promise<MessageContent> {
    return loadMessage(this.requireAccount(accountId), messageId, {
      db: this.db,
      archiveBaseDir: this.config.getSettings().archivePath,
      encryptionKey: this.config.archiveKey,
    });
  }

  loadAttachment(accountId: string, messageId: number, index: number): Promise<LoadedAttachment> {
    return loadAttachment(this.requireAccount(accountId), messageId, index, {
      db: this.db,
      archiveBaseDir: this.config.getSettings().archivePath,
      encryptionKey: this.config.archiveKey,
    });
  }

  loadMessageSource(
    accountId: string,
    messageId: number,
  ): Promise<{ source: Buffer; filePath: string; fileName: string }> {
    return loadMessageSource(this.requireAccount(accountId), messageId, {
      db: this.db,
      archiveBaseDir: this.config.getSettings().archivePath,
      encryptionKey: this.config.archiveKey,
    });
  }

  // ---------------------------------------------------------------- restore

  /**
   * Proposes how archived folders line up with the folders on a target server.
   *
   * The target may be the account itself (restoring what was lost) or a
   * completely different server (moving house).
   */
  async suggestRestoreMappings(
    accountId: string,
    target: ImapConnectionOptions,
  ): Promise<{ mappings: FolderMapping[]; targetFolders: string[] }> {
    const source = this.db.listFolders(accountId).map((folder) => ({
      path: folder.path,
      specialUse: folder.special_use,
    }));

    const remote = await withConnection(target, (client) => listRemoteFolders(client));
    const mappings = suggestMappings({
      source,
      target: remote.map((folder) => ({
        path: folder.path,
        specialUse: folder.specialUse,
        delimiter: folder.delimiter,
      })),
    });

    return { mappings, targetFolders: remote.filter((f) => !f.noSelect).map((f) => f.path) };
  }

  startRestore(options: {
    accountId: string;
    target: ImapConnectionOptions;
    mappings: FolderMapping[];
    selection: Omit<SearchOptions, 'accountId'>;
    skipExisting: boolean;
    restoreFlags: boolean;
  }): Promise<RestoreProgress | null> {
    return this.restore.start({
      db: this.db,
      archiveBaseDir: this.config.getSettings().archivePath,
      encryptionKey: this.config.archiveKey,
      sourceAccount: this.requireAccount(options.accountId),
      target: options.target,
      mappings: options.mappings,
      selection: { ...options.selection, accountId: options.accountId },
      skipExisting: options.skipExisting,
      restoreFlags: options.restoreFlags,
    });
  }

  cancelRestore(): boolean {
    return this.restore.cancel();
  }

  // ------------------------------------------------------- archive encryption

  /**
   * Converts the whole archive to or from encrypted storage.
   *
   * Changing the setting alone only affects new mail; this brings everything
   * that is already on disk in line.
   */
  startEncryptionMigration(direction: 'encrypt' | 'decrypt'): Promise<MigrationProgress | null> {
    const key = this.config.archiveKey;
    if (!key) throw new Error('Configuration is locked');

    const settings = this.config.getSettings();
    const layout = new ArchiveLayout(settings.archivePath);
    // The base directory covers most accounts; only those pointed somewhere
    // else need to be listed separately.
    const directories = [settings.archivePath];
    for (const account of this.config.listAccounts()) {
      const dir = layout.accountDir(account);
      if (!dir.startsWith(settings.archivePath)) directories.push(dir);
    }

    return this.migration.start({ directories, key, direction });
  }

  cancelEncryptionMigration(): boolean {
    return this.migration.cancel();
  }

  /** Permissions as configured, all off while MCP is disabled. */
  mcpPermissions(): McpPermissions {
    const mcp = this.config.getSettings().mcp;
    if (!mcp.enabled) {
      return {
        read: false,
        backup: false,
        export: false,
        accountsWrite: false,
        settingsWrite: false,
        delete: false,
      };
    }
    return mcp.permissions;
  }

  /** Builds an MCP server bound to this instance. */
  createMcpServer(): McpServer {
    return new McpServer({
      app: this,
      permissions: () => this.mcpPermissions(),
      serverName: 'amberchest',
      serverVersion: '1.0.0',
    });
  }

  /** True when this installation can render PDFs. */
  pdfAvailable(): Promise<boolean> {
    return isPdfAvailable(this.pdfRenderer);
  }

  /** Renders one message as PDF, for the button in the viewer. */
  async messageToPdf(
    accountId: string,
    messageId: number,
  ): Promise<{ fileName: string; content: Buffer }> {
    const renderer = this.pdfRenderer ?? chromiumPdfRenderer;
    const message = await this.loadMessage(accountId, messageId);
    const content = await renderer(
      messageToPrintableHtml(message, this.config.getSettings().language === 'en' ? 'en-GB' : 'de-DE'),
    );
    const stamp = message.date.slice(0, 10);
    const subject = (message.subject ?? 'nachricht').replace(/[^\p{L}\p{N}\s-]/gu, '').slice(0, 60).trim();
    return { fileName: `${stamp}_${subject || 'nachricht'}.pdf`, content };
  }

  startBundle(format: BundleFormat, selection: SearchOptions): string {
    return this.bundles.start(format, selection);
  }

  startIndexing(accountId: string): Promise<unknown> {
    const search = this.config.getSettings().search;
    return this.index.start(this.requireAccount(accountId), {
      indexAttachments: search.indexAttachments,
      maxAttachmentBytes: search.maxAttachmentBytes,
    });
  }

  cancelIndexing(accountId: string): boolean {
    return this.index.cancel(accountId);
  }

  resetIndex(accountId: string): void {
    this.db.clearIndex(accountId);
  }

  /** Starts a backup and, when configured, indexes what it brought in. */
  async startSyncAndIndex(accountId: string): Promise<SyncProgress | undefined> {
    const progress = await this.startSync(accountId);
    if (this.config.getSettings().search.autoIndex && !this.index.isRunning(accountId)) {
      void this.startIndexing(accountId).catch(() => undefined);
    }
    return progress;
  }

  /** Free space where the archive lives, or null when it cannot be read. */
  diskSpace(): Promise<DiskSpace | null> {
    return diskSpace(this.config.getSettings().archivePath);
  }

  /**
   * Free space plus what the user asked to be warned about.
   *
   * Kept in one place so the interface, the notification and the MQTT sensors
   * all mean the same thing by "low".
   */
  async storageStatus(): Promise<{
    space: DiskSpace | null;
    warnBelow: number;
    stopBelow: number;
    low: boolean;
  }> {
    const settings = this.config.getSettings().storage;
    const warnBelow = settings.warnBelowGb * 1024 * 1024 * 1024;
    const stopBelow = settings.stopBelowGb * 1024 * 1024 * 1024;
    const space = await this.diskSpace();
    return {
      space,
      warnBelow,
      stopBelow,
      low: Boolean(space && warnBelow > 0 && space.free < warnBelow),
    };
  }

  /** Tells the user when a backup ends badly, or brought something new. */
  private async notifyAboutSync(progress: SyncProgress): Promise<void> {
    const account = this.config.getAccount(progress.accountId);
    const name = account?.name ?? progress.accountId;

    if (progress.phase === 'failed') {
      await this.notifier.send({
        event: 'backupFailed',
        level: 'error',
        title: `AmberChest: backup of ${name} failed`,
        message: progress.error ?? 'The run ended with an error.',
        details: { account: name, accountId: progress.accountId, stats: progress.stats },
      });
      return;
    }

    if (progress.phase !== 'done') return;

    if (this.notifier.wants('backupFinished')) {
      const { messagesNew, messagesMoved, messagesDeleted } = progress.stats;
      await this.notifier.send({
        event: 'backupFinished',
        level: 'info',
        title: `AmberChest: ${name} backed up`,
        message: `${messagesNew} new, ${messagesMoved} moved, ${messagesDeleted} removed.`,
        details: { account: name, accountId: progress.accountId, stats: progress.stats },
      });
    }

    // The moment after a run is when a full disk actually matters.
    const status = await this.storageStatus();
    if (status.low && status.space) {
      await this.notifier.send({
        event: 'lowDiskSpace',
        level: 'warning',
        title: 'AmberChest: the archive volume is filling up',
        message:
          `Only ${Math.round(status.space.free / 1024 / 1024 / 1024)} GB left where the archive ` +
          `is stored. Below ${this.config.getSettings().storage.stopBelowGb} GB a backup stops ` +
          'instead of filling the volume.',
        details: { free: status.space.free, total: status.space.total, path: status.space.path },
      });
    }
  }

  /** Tells the user when a check found something. */
  private async notifyAboutVerify(progress: VerifyProgress): Promise<void> {
    const { missing, changed, unreadable, orphans, foldersDiffering } = progress.stats;
    if (missing + changed + unreadable + orphans + foldersDiffering === 0) return;

    const account = this.config.getAccount(progress.accountId);
    await this.notifier.send({
      event: 'verifyProblems',
      level: missing + changed + unreadable > 0 ? 'error' : 'warning',
      title: `AmberChest: the archive of ${account?.name ?? progress.accountId} has problems`,
      message:
        `${missing} missing, ${changed} changed, ${unreadable} unreadable, ${orphans} orphaned, ` +
        `${foldersDiffering} folder(s) differ from the server.`,
      details: { accountId: progress.accountId, stats: progress.stats },
    });
  }

  /**
   * Takes an archive directory that is already on disk into the index.
   *
   * The way an archive moves from the desktop app to a container, and the way
   * back after a lost index database.
   */
  startAdopt(
    accountId: string,
    options: { askServer?: boolean; includeDeleted?: boolean } = {},
  ): Promise<AdoptProgress> {
    return this.adopt.start(this.requireAccount(accountId), options);
  }

  /** Every message file and journal of an account, with its size. */
  async archiveManifest(accountId: string): Promise<Array<{ path: string; size: number }>> {
    const account = this.requireAccount(accountId);
    const layout = new ArchiveLayout(this.config.getSettings().archivePath);
    return listArchiveFiles(layout.accountDir(account));
  }

  /**
   * Writes one file into the archive of an account.
   *
   * Used by a transfer from another instance. The path segments are checked by
   * the route before they get here; this only ever writes below the account
   * directory.
   */
  async writeArchiveFile(accountId: string, segments: string[], body: Buffer): Promise<void> {
    const account = this.requireAccount(accountId);
    const layout = new ArchiveLayout(this.config.getSettings().archivePath);
    await writeArchiveFile(layout.accountDir(account), segments, body);
  }

  /**
   * Writes a plain HTML index into the archive of one account.
   *
   * So the archive stays usable without this program: one page per folder,
   * linking to the .eml files next to it.
   */
  writeRegister(accountId: string): Promise<RegisterResult> {
    const settings = this.config.getSettings();
    return writeRegister(this.requireAccount(accountId), {
      db: this.db,
      archiveBaseDir: settings.archivePath,
      encrypted: settings.encryptArchive,
      locale: settings.language === 'en' ? 'en-GB' : 'de-DE',
    });
  }

  /** Numbers about the archive, for the statistics screen. */
  statistics(accountId: string | null = null): ReturnType<ArchiveDatabase['statistics']> {
    if (accountId) this.requireAccount(accountId);
    return this.db.statistics(accountId);
  }

  /** Sends an archive to another instance, which then adopts it. */
  startTransfer(
    accountId: string,
    target: TransferTarget,
    options: { includeDeleted?: boolean } = {},
  ): Promise<TransferProgress> {
    return this.transfer.start(this.requireAccount(accountId), target, options);
  }

  /** Checks the files of one account against the index, and the server. */
  startVerify(
    accountId: string,
    options: { checkServer?: boolean; includeDeleted?: boolean } = {},
  ): Promise<VerifyProgress> {
    return this.verify.start(this.requireAccount(accountId), options);
  }

  cancelVerify(accountId: string): boolean {
    return this.verify.cancel(accountId);
  }

  lastVerify(accountId: string): VerifyProgress | null {
    return this.verify.lastRun(accountId);
  }

  startSync(accountId: string): Promise<SyncProgress | undefined> {
    return this.sync.start(this.requireAccount(accountId));
  }

  cancelSync(accountId: string): boolean {
    return this.sync.cancel(accountId);
  }

  close(): void {
    void this.mqtt.stop();
    this.db.close();
  }
}

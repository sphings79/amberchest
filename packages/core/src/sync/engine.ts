import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { join, relative } from 'node:path';
import type { ImapFlow } from 'imapflow';
import type { ArchiveDatabase, FolderRow, MessageRow } from '../db/database.js';
import {
  connectionOptionsFromAccount,
  type ImapConnectionOptions,
  describeImapError,
  fetchSources,
  listRemoteFolders,
  openFolderReadOnly,
  scanFolder,
  withConnection,
  type ScannedMessage,
} from '../imap/client.js';
import {
  ArchiveLayout,
  listMessageFiles,
  moveFolderDir,
  moveMessageFile,
  purgeMessageFile,
  recordFlagChange,
  recordFolder,
  recordLink,
  storeMessage,
} from '../storage/archive.js';
import { assertRoom } from '../storage/disk.js';
import type { Account, RemoteFolder, SyncProgress, SyncStats } from '../types.js';
import { mapWithConcurrency, sleep } from '../util/concurrency.js';
import { logger } from '../util/logger.js';
import { messageFileName, uniqueFileName } from '../util/paths.js';

export class SyncCancelledError extends Error {
  constructor() {
    super('Sync cancelled');
    this.name = 'SyncCancelledError';
  }
}

function emptyStats(): SyncStats {
  return {
    foldersTotal: 0,
    foldersDone: 0,
    messagesNew: 0,
    messagesLinked: 0,
    messagesMoved: 0,
    messagesDeleted: 0,
    messagesRestored: 0,
    flagsUpdated: 0,
    bytesDownloaded: 0,
  };
}

/** Everything the diff produced for one folder. */
interface FolderPlan {
  folder: FolderRow;
  remote: RemoteFolder;
  scanned: ScannedMessage[];
  /** UIDs present on the server but not in the archive. */
  newUids: number[];
  /** Local rows whose UID vanished from the server. */
  missing: MessageRow[];
  uidValidity: number;
  uidNext: number;
}

export interface SyncEngineOptions {
  db: ArchiveDatabase;
  archiveBaseDir: string;
  /** Stop rather than fill the volume; zero switches the guard off. */
  stopBelowBytes?: number;
  /** When set, message files are written encrypted. */
  encryptionKey?: Buffer | null;
  /** Prepared connection; an OAuth account arrives with a fresh token. */
  connection?: ImapConnectionOptions | undefined;
}

/**
 * Archives one account.
 *
 * The run has three passes. The scan pass reads UID, flags and envelope of
 * every selected folder - cheap, and enough to tell new, gone and changed
 * apart. The match pass links messages that vanished in one folder to messages
 * that appeared in another, so a mail moved on the server is moved locally
 * instead of downloaded again. Only then does the download pass fetch bodies.
 */
export class SyncEngine extends EventEmitter {
  readonly runId = randomUUID();

  private cancelled = false;
  private readonly stats = emptyStats();
  private readonly layout: ArchiveLayout;
  private currentFolder: string | null = null;
  private folderDone = 0;
  private folderTotal = 0;
  private readonly startedAt = new Date().toISOString();

  constructor(
    private readonly account: Account,
    private readonly options: SyncEngineOptions,
  ) {
    super();
    this.layout = new ArchiveLayout(options.archiveBaseDir);
  }

  cancel(): void {
    this.cancelled = true;
  }

  private get db(): ArchiveDatabase {
    return this.options.db;
  }

  private checkCancelled(): void {
    if (this.cancelled) throw new SyncCancelledError();
  }

  private emitProgress(phase: SyncProgress['phase'], error?: string): void {
    const progress: SyncProgress = {
      runId: this.runId,
      accountId: this.account.id,
      phase,
      currentFolder: this.currentFolder,
      folderMessagesDone: this.folderDone,
      folderMessagesTotal: this.folderTotal,
      stats: { ...this.stats },
      startedAt: this.startedAt,
      ...(error ? { error } : {}),
    };
    this.emit('progress', progress);
  }

  async run(): Promise<SyncStats> {
    this.db.startRun(this.runId, this.account.id);
    logger.info(`Starting backup for ${this.account.name}`, { accountId: this.account.id });
    this.emitProgress('connecting');

    try {
      const connection = this.options.connection ?? connectionOptionsFromAccount(this.account);
      const stats = await withConnection(connection, async (client) => {
        return this.execute(client);
      });
      this.db.finishRun(this.runId, 'done', stats);
      this.emitProgress('done');
      logger.info(
        `Backup finished for ${this.account.name}: ${stats.messagesNew} new, ${stats.messagesMoved} moved, ${stats.messagesDeleted} removed`,
        { accountId: this.account.id },
      );
      return stats;
    } catch (error) {
      if (error instanceof SyncCancelledError) {
        this.db.finishRun(this.runId, 'cancelled', this.stats);
        this.emitProgress('cancelled');
        logger.warn(`Backup cancelled for ${this.account.name}`, { accountId: this.account.id });
        return this.stats;
      }
      const message = describeImapError(error);
      this.db.finishRun(this.runId, 'failed', this.stats, message);
      this.emitProgress('failed', message);
      logger.error(`Backup failed for ${this.account.name}: ${message}`, {
        accountId: this.account.id,
        detail: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }

  private async execute(client: ImapFlow): Promise<SyncStats> {
    this.emitProgress('listing-folders');
    const remoteFolders = await listRemoteFolders(client, { withCounts: false });
    this.checkCancelled();

    const selectable = remoteFolders.filter((folder) => !folder.noSelect);
    const remoteByPath = new Map(selectable.map((folder) => [folder.path, folder]));

    // Refresh the folder table and take care of folders that disappeared.
    for (const folder of selectable) {
      this.db.upsertFolder(
        this.account.id,
        folder,
        this.layout.relativeFolderPath(folder.path, folder.delimiter),
      );
    }
    await this.handleVanishedFolders(remoteByPath);

    const selectedPaths = this.account.selectedFolders.filter((path) => remoteByPath.has(path));
    this.db.setSelectedFolders(this.account.id, selectedPaths);
    this.stats.foldersTotal = selectedPaths.length;

    if (selectedPaths.length === 0) {
      logger.warn('No folders selected for this account', { accountId: this.account.id });
      return this.stats;
    }

    // --- pass 1: scan -----------------------------------------------------
    this.emitProgress('scanning');
    const plans: FolderPlan[] = [];
    for (const path of selectedPaths) {
      this.checkCancelled();
      const remote = remoteByPath.get(path) as RemoteFolder;
      const plan = await this.scanOneFolder(client, remote);
      if (plan) plans.push(plan);
    }

    // --- pass 2: match moves ---------------------------------------------
    this.emitProgress('matching');
    await this.matchMoves(plans);

    // --- pass 3: download -------------------------------------------------
    this.emitProgress('downloading');
    for (const plan of plans) {
      this.checkCancelled();
      await this.downloadFolder(client, plan);
      this.stats.foldersDone += 1;
      this.emitProgress('downloading');
    }

    // --- pass 4: finalize -------------------------------------------------
    this.emitProgress('finalizing');
    await this.purgeExpiredDeleted();

    return this.stats;
  }

  /** Handles folders that are in the archive but no longer on the server. */
  private async handleVanishedFolders(remoteByPath: Map<string, RemoteFolder>): Promise<void> {
    const handling = this.account.settings.deletedHandling;
    const accountDir = this.layout.accountDir(this.account);

    for (const local of this.db.listFolders(this.account.id)) {
      if (remoteByPath.has(local.path)) continue;
      if (handling === 'keep') {
        logger.info(`Folder ${local.path} vanished on the server, keeping the local copy`, {
          accountId: this.account.id,
        });
        continue;
      }

      const sourceDir = join(accountDir, local.local_path);
      if (handling === 'move-to-deleted') {
        const targetDir = this.layout.deletedDir(this.account, local.local_path);
        await moveFolderDir(sourceDir, targetDir);
        const now = new Date().toISOString();
        for (const message of this.db.listActiveMessages(local.id)) {
          this.db.markDeleted(message.id, now);
          this.stats.messagesDeleted += 1;
        }
        logger.info(`Folder ${local.path} vanished, moved to ${targetDir}`, {
          accountId: this.account.id,
        });
      } else {
        this.db.deleteFolder(local.id);
        logger.info(`Folder ${local.path} vanished, removed from the index`, {
          accountId: this.account.id,
        });
      }
    }
  }

  private async scanOneFolder(client: ImapFlow, remote: RemoteFolder): Promise<FolderPlan | null> {
    this.currentFolder = remote.path;
    this.folderDone = 0;
    this.folderTotal = 0;
    this.emitProgress('scanning');

    const relativeFolder = this.layout.relativeFolderPath(remote.path, remote.delimiter);
    const folder = this.db.upsertFolder(this.account.id, remote, relativeFolder);

    // Once per folder and run: what this directory is called on the server, so
    // the archive can be adopted elsewhere without asking.
    await recordFolder(join(this.layout.accountDir(this.account), relativeFolder), {
      path: remote.path,
      delimiter: remote.delimiter,
      specialUse: remote.specialUse,
      uidvalidity: folder.uidvalidity,
    });

    let state;
    try {
      state = await openFolderReadOnly(client, remote.path);
    } catch (error) {
      logger.warn(`Cannot open ${remote.path}: ${describeImapError(error)}`, {
        accountId: this.account.id,
      });
      return null;
    }

    const since = this.account.settings.sinceDate ? new Date(this.account.settings.sinceDate) : null;
    const scanned = await scanFolder(client, {
      since,
      onProgress: (done, total) => {
        this.folderDone = done;
        this.folderTotal = total;
        if (done % 250 === 0) this.emitProgress('scanning');
      },
    });
    this.checkCancelled();

    const localRows = this.db.listActiveMessages(folder.id);
    const uidValidityChanged =
      folder.uidvalidity !== null && folder.uidvalidity !== state.uidValidity;

    if (uidValidityChanged) {
      logger.warn(
        `UIDVALIDITY of ${remote.path} changed from ${folder.uidvalidity} to ${state.uidValidity}, re-matching by fingerprint`,
        { accountId: this.account.id },
      );
    }

    const byUid = new Map(localRows.map((row) => [row.uid, row]));
    const byFingerprint = new Map<string, MessageRow>();
    for (const row of localRows) byFingerprint.set(row.fingerprint, row);

    const newUids: number[] = [];
    const seenRowIds = new Set<number>();

    for (const message of scanned) {
      // After a UIDVALIDITY change the old UIDs are meaningless, so the
      // fingerprint is the only way to recognise a message we already have.
      const existing = uidValidityChanged
        ? byFingerprint.get(message.fingerprint)
        : byUid.get(message.uid) ?? byFingerprint.get(message.fingerprint);

      if (!existing) {
        newUids.push(message.uid);
        continue;
      }

      seenRowIds.add(existing.id);

      if (uidValidityChanged || existing.uid !== message.uid) {
        this.db.moveMessage(existing.id, {
          folderId: folder.id,
          uid: message.uid,
          uidvalidity: state.uidValidity,
          fileName: existing.file_name,
        });
      }

      const storedFlags = JSON.parse(existing.flags) as string[];
      if (!sameFlags(storedFlags, message.flags)) {
        this.db.updateFlags(existing.id, message.flags);
        await recordFlagChange(
          this.layout.folderDir(this.account, relativeFolder),
          existing.file_name,
          message.flags,
        );
        this.stats.flagsUpdated += 1;
      }
    }

    const missing = localRows.filter((row) => !seenRowIds.has(row.id));

    this.db.updateFolderSyncState(folder.id, {
      uidvalidity: state.uidValidity,
      uidnext: state.uidNext,
    });

    return {
      folder: { ...folder, uidvalidity: state.uidValidity },
      remote,
      scanned,
      newUids,
      missing,
      uidValidity: state.uidValidity,
      uidNext: state.uidNext,
    };
  }

  /**
   * Links messages that vanished from one folder to messages that appeared in
   * another one. Both sides are known before any body is downloaded, so a mail
   * that was moved on the server costs a local rename instead of a download.
   */
  private async matchMoves(plans: FolderPlan[]): Promise<void> {
    const arrivals = new Map<string, { plan: FolderPlan; message: ScannedMessage }>();
    for (const plan of plans) {
      const newUidSet = new Set(plan.newUids);
      for (const message of plan.scanned) {
        if (newUidSet.has(message.uid) && !arrivals.has(message.fingerprint)) {
          arrivals.set(message.fingerprint, { plan, message });
        }
      }
    }

    const accountDir = this.layout.accountDir(this.account);

    for (const plan of plans) {
      const stillMissing: MessageRow[] = [];

      for (const row of plan.missing) {
        this.checkCancelled();
        const arrival = arrivals.get(row.fingerprint);
        if (!arrival || arrival.plan.folder.id === plan.folder.id) {
          stillMissing.push(row);
          continue;
        }

        const sourceDir = join(accountDir, plan.folder.local_path);
        const targetRelative = arrival.plan.folder.local_path;
        const targetDir = join(accountDir, targetRelative);
        const taken = await listMessageFiles(targetDir);
        const fileName = uniqueFileName(
          messageFileName({
            internalDate: arrival.message.internalDate,
            uid: arrival.message.uid,
            subject: arrival.message.subject,
          }),
          taken,
        );

        await moveMessageFile(
          sourceDir,
          row.file_name,
          targetDir,
          fileName,
          {
            uid: arrival.message.uid,
            uidvalidity: arrival.plan.uidValidity,
            messageId: arrival.message.messageId,
            fingerprint: arrival.message.fingerprint,
            internalDate: arrival.message.internalDate.toISOString(),
            size: arrival.message.size,
            subject: arrival.message.subject,
            from: arrival.message.fromAddress,
            to: arrival.message.toAddress,
            flags: arrival.message.flags,
          },
          'moved',
          targetRelative,
          plan.folder.local_path,
        );

        this.db.moveMessage(row.id, {
          folderId: arrival.plan.folder.id,
          uid: arrival.message.uid,
          uidvalidity: arrival.plan.uidValidity,
          fileName,
        });
        this.db.updateFlags(row.id, arrival.message.flags);

        // The message is accounted for, so it must not be downloaded again.
        arrival.plan.newUids = arrival.plan.newUids.filter((uid) => uid !== arrival.message.uid);
        arrivals.delete(row.fingerprint);
        this.stats.messagesMoved += 1;
      }

      plan.missing = stillMissing;
    }

    for (const plan of plans) {
      await this.handleMissing(plan);
    }

  }

  /**
   * Stores a message once when it sits in several folders at the same time.
   *
   * Gmail is the reason: every mail is in its folder and in All Mail, so an
   * archive holds it twice. What is left after the move matching is exactly
   * that case - the same message, still present elsewhere. The row stays, so
   * the folder tree is unchanged, and the bytes are neither downloaded nor
   * written a second time.
   */
  private async linkDuplicates(plan: FolderPlan): Promise<void> {
    {
      const remaining: number[] = [];
      const scannedByUid = new Map(plan.scanned.map((message) => [message.uid, message]));

      for (const uid of plan.newUids) {
        this.checkCancelled();
        const message = scannedByUid.get(uid);
        if (!message) {
          remaining.push(uid);
          continue;
        }

        const owner = this.db.findLinkTarget(
          this.account.id,
          message.fingerprint,
          plan.folder.id,
        );
        if (!owner) {
          remaining.push(uid);
          continue;
        }

        this.db.insertMessage({
          accountId: this.account.id,
          folderId: plan.folder.id,
          uid,
          uidvalidity: plan.uidValidity,
          messageId: message.messageId,
          fingerprint: message.fingerprint,
          internalDate: message.internalDate.toISOString(),
          size: message.size,
          subject: message.subject,
          fromAddr: message.fromAddress,
          toAddr: message.toAddress,
          flags: message.flags,
          // No file of its own; the name of the one that holds the bytes.
          fileName: owner.file_name,
          sha256: owner.sha256,
          linkedTo: owner.id,
        });

        // Into the journal as well, so an adopted archive knows about it.
        const ownerFolder = this.db
          .listFolders(this.account.id)
          .find((entry) => entry.id === owner.folder_id);
        if (ownerFolder) {
          await recordLink(
            join(this.layout.accountDir(this.account), plan.folder.local_path),
            owner.file_name,
            `${ownerFolder.local_path}/${owner.file_name}`,
            {
              uid,
              uidvalidity: plan.uidValidity,
              messageId: message.messageId,
              fingerprint: message.fingerprint,
              internalDate: message.internalDate.toISOString(),
              size: message.size,
              subject: message.subject,
              from: message.fromAddress,
              to: message.toAddress,
              flags: message.flags,
            },
          );
        }

        this.stats.messagesLinked += 1;
      }

      plan.newUids = remaining;
    }
  }

  /**
   * Passes a shared file on before its owner is deleted.
   *
   * A linked message has no bytes of its own. When the folder that holds them
   * loses the message, the file moves to one of the folders still showing it,
   * and the rest point at that one instead.
   */
  private async handOverFile(row: MessageRow, sourceDir: string): Promise<boolean> {
    const links = this.db.listLinks(row.id);
    const heir = links.find((link) => link.state === 'active');
    if (!heir) return false;

    const accountDir = this.layout.accountDir(this.account);
    const heirFolder = this.db.listFolders(this.account.id).find((f) => f.id === heir.folder_id);
    if (!heirFolder) return false;

    const targetDir = join(accountDir, heirFolder.local_path);
    const taken = await listMessageFiles(targetDir);
    const fileName = uniqueFileName(row.file_name, taken);

    await moveMessageFile(
      sourceDir,
      row.file_name,
      targetDir,
      fileName,
      {
        uid: heir.uid,
        uidvalidity: heir.uidvalidity,
        messageId: heir.message_id,
        fingerprint: heir.fingerprint,
        internalDate: heir.internal_date,
        size: heir.size,
        subject: heir.subject,
        from: heir.from_addr,
        to: heir.to_addr,
        flags: JSON.parse(heir.flags) as string[],
      },
      'moved',
      heirFolder.local_path,
      // The source folder is the one losing the message.
      relative(accountDir, sourceDir),
    );

    this.db.promoteLink(heir.id, fileName, heir.folder_id);
    this.db.removeMessage(row.id);
    logger.info(
      `${row.file_name} is still shown by ${heirFolder.path}, the file went there`,
      { accountId: this.account.id },
    );
    return true;
  }

  /** Applies the configured policy to messages that are gone from the server. */
  private async handleMissing(plan: FolderPlan): Promise<void> {
    if (plan.missing.length === 0) return;
    const handling = this.account.settings.deletedHandling;
    const accountDir = this.layout.accountDir(this.account);
    const sourceDir = join(accountDir, plan.folder.local_path);

    if (handling === 'keep') {
      logger.info(
        `${plan.missing.length} message(s) vanished from ${plan.folder.path}, keeping local copies`,
        { accountId: this.account.id },
      );
      return;
    }

    for (const row of plan.missing) {
      this.checkCancelled();

      // Another folder may be showing the same message through this file. It
      // has to keep it, otherwise deleting one copy would lose both.
      if (await this.handOverFile(row, sourceDir)) continue;

      if (handling === 'mirror') {
        await purgeMessageFile(sourceDir, row.file_name);
        this.db.removeMessage(row.id);
      } else {
        const targetRelative = join('_deleted', plan.folder.local_path);
        const targetDir = this.layout.deletedDir(this.account, plan.folder.local_path);
        const taken = await listMessageFiles(targetDir);
        const fileName = uniqueFileName(row.file_name, taken);
        await moveMessageFile(
          sourceDir,
          row.file_name,
          targetDir,
          fileName,
          {
            uid: row.uid,
            uidvalidity: row.uidvalidity,
            messageId: row.message_id,
            fingerprint: row.fingerprint,
            internalDate: row.internal_date,
            size: row.size,
            subject: row.subject,
            from: row.from_addr,
            to: row.to_addr,
            flags: JSON.parse(row.flags) as string[],
          },
          'deleted',
          targetRelative,
          plan.folder.local_path,
        );
        // The row keeps its folder, only the file name may have changed while
        // moving into the _deleted tree; the state flip has to come last
        // because moveMessage revives a row.
        this.db.moveMessage(row.id, {
          folderId: row.folder_id,
          uid: row.uid,
          uidvalidity: row.uidvalidity,
          fileName,
        });
        this.db.markDeleted(row.id);
      }
      this.stats.messagesDeleted += 1;
    }
  }

  private async downloadFolder(client: ImapFlow, plan: FolderPlan): Promise<void> {
    // Before anything is fetched: a message already archived in another folder
    // gets a row pointing at that file instead of a download of its own.
    if (this.account.settings.linkDuplicates) await this.linkDuplicates(plan);
    if (plan.newUids.length === 0) return;

    this.currentFolder = plan.remote.path;
    this.folderDone = 0;
    this.folderTotal = plan.newUids.length;
    this.emitProgress('downloading');

    await openFolderReadOnly(client, plan.remote.path);

    const accountDir = this.layout.accountDir(this.account);
    const folderDir = join(accountDir, plan.folder.local_path);
    // Checked once per folder rather than per message: cheap enough to be
    // honest about, and a folder is not big enough to fill a disk on its own.
    await assertRoom(accountDir, this.options.stopBelowBytes ?? 0);
    const taken = await listMessageFiles(folderDir);
    const scannedByUid = new Map(plan.scanned.map((message) => [message.uid, message]));
    const delay = this.account.settings.requestDelayMs;

    await fetchSources(
      client,
      plan.newUids,
      this.account.settings.batchSize,
      async (uid, source, flags) => {
        const meta = scannedByUid.get(uid);
        if (!meta) return;

        const fileName = uniqueFileName(
          messageFileName({ internalDate: meta.internalDate, uid, subject: meta.subject }),
          taken,
        );
        taken.add(fileName);

        await storeMessage(
          folderDir,
          fileName,
          source,
          {
            uid,
            uidvalidity: plan.uidValidity,
            messageId: meta.messageId,
            fingerprint: meta.fingerprint,
            internalDate: meta.internalDate.toISOString(),
            size: source.length,
            subject: meta.subject,
            from: meta.fromAddress,
            to: meta.toAddress,
            flags: flags.length > 0 ? flags : meta.flags,
          },
          meta.internalDate,
          this.options.encryptionKey ?? null,
        );

        this.db.insertMessage({
          accountId: this.account.id,
          folderId: plan.folder.id,
          uid,
          uidvalidity: plan.uidValidity,
          messageId: meta.messageId,
          fingerprint: meta.fingerprint,
          internalDate: meta.internalDate.toISOString(),
          size: source.length,
          subject: meta.subject,
          fromAddr: meta.fromAddress,
          toAddr: meta.toAddress,
          flags: flags.length > 0 ? flags : meta.flags,
          fileName,
          // Of the message, not of the file: the file changes when the
          // archive is encrypted, the message does not.
          sha256: createHash('sha256').update(source).digest('hex'),
        });

        this.stats.messagesNew += 1;
        this.stats.bytesDownloaded += source.length;
        this.folderDone += 1;
        if (this.folderDone % 25 === 0) this.emitProgress('downloading');
        if (delay > 0) await sleep(delay);
      },
      () => this.cancelled,
    );

    this.checkCancelled();
    this.db.updateFolderSyncState(plan.folder.id, { lastSync: new Date().toISOString() });
    this.emitProgress('downloading');
  }

  /** Removes `_deleted` entries that are older than the retention window. */
  private async purgeExpiredDeleted(): Promise<void> {
    const days = this.account.settings.deletedRetentionDays;
    if (!days) return;

    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const expired = this.db.listDeletedMessages(this.account.id, cutoff);
    if (expired.length === 0) return;

    const accountDir = this.layout.accountDir(this.account);
    const folders = new Map(this.db.listFolders(this.account.id).map((row) => [row.id, row]));

    for (const row of expired) {
      const folder = folders.get(row.folder_id);
      if (!folder) continue;
      const dir = join(accountDir, '_deleted', folder.local_path);
      await purgeMessageFile(dir, row.file_name);
      this.db.removeMessage(row.id);
    }

    logger.info(`Purged ${expired.length} message(s) from _deleted (older than ${days} days)`, {
      accountId: this.account.id,
    });
  }
}

function sameFlags(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  return b.every((flag) => setA.has(flag));
}

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import type { ArchiveDatabase } from '../db/database.js';
import { listRemoteFolders, withConnection, type ImapConnectionOptions } from '../imap/client.js';
import { ArchiveLayout } from '../storage/archive.js';
import { openMessageFile } from '../storage/encryption.js';
import { readJournal, type JournalRecord } from '../storage/journal.js';
import type { Account, RemoteFolder } from '../types.js';
import { messageFingerprint } from '../util/hash.js';
import { logger } from '../util/logger.js';
import { JOURNAL_FILE } from '../util/paths.js';

export class AdoptCancelledError extends Error {
  constructor() {
    super('Adoption cancelled');
    this.name = 'AdoptCancelledError';
  }
}

export type AdoptPhase = 'scanning' | 'folders' | 'messages' | 'done' | 'cancelled' | 'failed';

export interface AdoptStats {
  foldersFound: number;
  foldersAdopted: number;
  messagesFound: number;
  /** Taken over with everything the journal knew, UID included. */
  messagesAdopted: number;
  /** Taken over by reading the file, because no journal entry described it. */
  messagesRebuilt: number;
  /** Described by the journal, but the file is not on disk. */
  messagesMissing: number;
  /** Already in the index; adoption never creates a second row. */
  messagesSkipped: number;
  /** Rows for messages whose file lives in another folder. */
  messagesLinked: number;
  bytesRead: number;
}

export interface AdoptProgress {
  runId: string;
  accountId: string;
  phase: AdoptPhase;
  currentFolder: string | null;
  stats: AdoptStats;
  /** Folders whose name on the server had to be guessed. */
  guessedFolders: string[];
  startedAt: string;
  error?: string;
}

export interface AdoptOptions {
  db: ArchiveDatabase;
  archiveBaseDir: string;
  encryptionKey?: Buffer | null;
  /** When given, the server is asked what its folders are really called. */
  connection?: ImapConnectionOptions | undefined;
  /** Take over the _deleted tree as well. */
  includeDeleted?: boolean;
}

interface AdoptedMessage {
  file: string;
  uid: number;
  uidvalidity: number;
  messageId: string | null;
  fingerprint: string;
  internalDate: string;
  size: number;
  subject: string | null;
  from: string | null;
  to: string | null;
  flags: string[];
}

/**
 * Takes an archive directory into the index.
 *
 * This is how an archive moves from the desktop app into a container, and how
 * it comes back after the index database was lost: the .eml files and the
 * journal in every folder hold everything the index does. Files are only ever
 * read, never written.
 *
 * Messages the journal describes keep their UID, so the next backup carries on
 * where the old machine stopped. A file without a journal entry is read
 * instead and gets UIDVALIDITY zero, which makes the next backup match it to
 * the server by fingerprint rather than download it again - the same path an
 * actual UIDVALIDITY change takes.
 */
export class AdoptEngine extends EventEmitter {
  readonly runId = randomUUID();

  private cancelled = false;
  private currentFolder: string | null = null;
  private synthetic = 0;
  private readonly guessed: string[] = [];
  private readonly pendingLinks: Array<{
    target: string;
    message: AdoptedMessage;
    folderId: number;
  }> = [];
  private readonly startedAt = new Date().toISOString();
  private readonly stats: AdoptStats = {
    foldersFound: 0,
    foldersAdopted: 0,
    messagesFound: 0,
    messagesAdopted: 0,
    messagesRebuilt: 0,
    messagesMissing: 0,
    messagesSkipped: 0,
    messagesLinked: 0,
    bytesRead: 0,
  };

  constructor(
    private readonly account: Account,
    private readonly options: AdoptOptions,
  ) {
    super();
  }

  cancel(): void {
    this.cancelled = true;
  }

  private emitProgress(phase: AdoptPhase, error?: string): void {
    this.emit('progress', this.progress(phase, error));
  }

  private progress(phase: AdoptPhase, error?: string): AdoptProgress {
    return {
      runId: this.runId,
      accountId: this.account.id,
      phase,
      currentFolder: this.currentFolder,
      stats: { ...this.stats },
      guessedFolders: [...this.guessed],
      startedAt: this.startedAt,
      ...(error ? { error } : {}),
    };
  }

  async run(): Promise<AdoptProgress> {
    const layout = new ArchiveLayout(this.options.archiveBaseDir);
    const accountDir = layout.accountDir(this.account);
    logger.info(`Adopting the archive in ${accountDir} for ${this.account.name}`);
    this.emitProgress('scanning');

    try {
      const directories = await this.folderDirectories(accountDir);
      this.stats.foldersFound = directories.length;
      this.emitProgress('folders');

      // What the server calls its folders, when it can be asked at all.
      const remote = this.options.connection
        ? await withConnection(this.options.connection, (client) => listRemoteFolders(client))
        : [];

      for (const relativeDir of directories) {
        if (this.cancelled) throw new AdoptCancelledError();
        this.currentFolder = relativeDir;
        this.emitProgress('messages');
        await this.adoptFolder(accountDir, relativeDir, remote);
        this.stats.foldersAdopted += 1;
      }

      this.adoptLinks();

      this.currentFolder = null;
      this.emitProgress('done');
      logger.info(
        `Adoption finished: ${this.stats.foldersAdopted} folder(s), ` +
          `${this.stats.messagesAdopted} message(s) from the journal, ` +
          `${this.stats.messagesRebuilt} read from disk`,
      );
      return this.progress('done');
    } catch (error) {
      if (error instanceof AdoptCancelledError) {
        this.emitProgress('cancelled');
        return this.progress('cancelled');
      }
      const message = (error as Error).message;
      this.emitProgress('failed', message);
      logger.error(`Adoption failed: ${message}`);
      return this.progress('failed', message);
    }
  }

  /** Every directory that holds messages, relative to the account directory. */
  private async folderDirectories(accountDir: string): Promise<string[]> {
    const found: string[] = [];

    const walk = async (directory: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch {
        return;
      }

      const hasMessages = entries.some((entry) => entry.isFile() && entry.name.endsWith('.eml'));
      const hasJournal = entries.some((entry) => entry.isFile() && entry.name === JOURNAL_FILE);
      const relativeDir = relative(accountDir, directory);

      if (relativeDir && (hasMessages || hasJournal)) found.push(relativeDir);

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (!this.options.includeDeleted && entry.name === '_deleted' && !relativeDir) continue;
        await walk(join(directory, entry.name));
      }
    };

    await walk(accountDir);
    return found;
  }

  private async adoptFolder(
    accountDir: string,
    relativeDir: string,
    remote: RemoteFolder[],
  ): Promise<void> {
    const folderDir = join(accountDir, relativeDir);
    const records = await readJournal(folderDir);
    const deleted = relativeDir.split(sep)[0] === '_deleted';
    const localPath = deleted ? relativeDir.split(sep).slice(1).join(sep) : relativeDir;

    const described = this.describeFolder(localPath, records, remote);
    const folder = this.options.db.upsertFolder(this.account.id, described, localPath);

    const known = new Map<string, AdoptedMessage>();
    const removed = new Set<string>();
    // Messages this folder shows although the file lives elsewhere.
    const links: Array<{ target: string; message: AdoptedMessage }> = [];

    for (const record of records) {
      if (record.op === 'add') {
        known.set(record.file, {
          file: record.file,
          uid: record.uid,
          uidvalidity: record.uidvalidity,
          messageId: record.messageId,
          fingerprint: record.fingerprint,
          internalDate: record.internalDate,
          size: record.size,
          subject: record.subject,
          from: record.from,
          to: record.to,
          flags: record.flags,
        });
        removed.delete(record.file);
      } else if (record.op === 'link') {
        links.push({
          target: record.target,
          message: {
            file: record.file,
            uid: record.uid,
            uidvalidity: record.uidvalidity,
            messageId: record.messageId,
            fingerprint: record.fingerprint,
            internalDate: record.internalDate,
            size: record.size,
            subject: record.subject,
            from: record.from,
            to: record.to,
            flags: record.flags,
          },
        });
      } else if (record.op === 'flags') {
        const entry = known.get(record.file);
        if (entry) entry.flags = record.flags;
      } else if (record.op === 'remove') {
        // The file left this folder; wherever it went keeps its own journal.
        removed.add(record.file);
        known.delete(record.file);
      }
    }

    const onDisk = await this.messageFiles(folderDir);
    this.stats.messagesFound += onDisk.length;

    for (const file of onDisk) {
      if (this.cancelled) throw new AdoptCancelledError();

      if (this.options.db.findMessageByFile(this.account.id, folder.id, file)) {
        this.stats.messagesSkipped += 1;
        continue;
      }

      const fromJournal = known.get(file);
      const message = fromJournal ?? (await this.rebuildFromFile(folderDir, file));
      if (!message) continue;

      const id = this.options.db.insertMessage({
        accountId: this.account.id,
        folderId: folder.id,
        uid: message.uid,
        uidvalidity: message.uidvalidity,
        messageId: message.messageId,
        fingerprint: message.fingerprint,
        internalDate: message.internalDate,
        size: message.size,
        subject: message.subject,
        fromAddr: message.from,
        toAddr: message.to,
        flags: message.flags,
        fileName: file,
      });

      if (deleted) this.options.db.markDeleted(id, new Date().toISOString());

      if (fromJournal) this.stats.messagesAdopted += 1;
      else this.stats.messagesRebuilt += 1;
    }

    // Kept for the end: the folder that owns the file has to exist first.
    this.pendingLinks.push(...links.map((link) => ({ ...link, folderId: folder.id })));

    const present = new Set(onDisk);
    for (const file of known.keys()) {
      if (!present.has(file) && !removed.has(file)) this.stats.messagesMissing += 1;
    }
  }

  /**
   * Restores the rows for messages that share a file with another folder.
   *
   * Done once every folder is in the index, because a link can only be made to
   * a message that is already there.
   */
  private adoptLinks(): void {
    for (const link of this.pendingLinks) {
      const segments = link.target.split('/');
      const fileName = segments.pop() ?? '';
      const ownerFolder = this.options.db
        .listFolders(this.account.id)
        .find((entry) => entry.local_path === segments.join(sep));
      if (!ownerFolder) continue;

      const owner = this.options.db.findMessageByFile(this.account.id, ownerFolder.id, fileName);
      if (!owner) continue;
      if (this.options.db.findMessageByFile(this.account.id, link.folderId, fileName)) continue;

      this.options.db.insertMessage({
        accountId: this.account.id,
        folderId: link.folderId,
        uid: link.message.uid,
        uidvalidity: link.message.uidvalidity,
        messageId: link.message.messageId,
        fingerprint: link.message.fingerprint,
        internalDate: link.message.internalDate,
        size: link.message.size,
        subject: link.message.subject,
        fromAddr: link.message.from,
        toAddr: link.message.to,
        flags: link.message.flags,
        fileName,
        sha256: owner.sha256,
        linkedTo: owner.id,
      });
      this.stats.messagesLinked += 1;
    }
  }

  /**
   * What this directory is called on the server.
   *
   * The journal says so since this version; an older archive is matched
   * against the server's folder list, and only when neither is available does
   * the path get guessed from the directory names.
   */
  private describeFolder(
    localPath: string,
    records: JournalRecord[],
    remote: RemoteFolder[],
  ): RemoteFolder {
    for (let index = records.length - 1; index >= 0; index -= 1) {
      const record = records[index];
      if (record?.op === 'folder') {
        const delimiter = record.delimiter || '/';
        return {
          path: record.path,
          name: record.path.split(delimiter).pop() ?? record.path,
          delimiter,
          specialUse: record.specialUse,
          noSelect: false,
          messageCount: null,
          sizeBytes: null,
        };
      }
    }

    const segments = localPath.split(sep);
    const match = remote.find(
      (folder) => folder.path.split(folder.delimiter || '/').join(' ') === segments.join(' '),
    );
    if (match) return match;

    this.guessed.push(localPath);
    return {
      path: segments.join('/'),
      name: segments[segments.length - 1] ?? localPath,
      delimiter: '/',
      specialUse: null,
      noSelect: false,
      messageCount: null,
      sizeBytes: null,
    };
  }

  private async messageFiles(folderDir: string): Promise<string[]> {
    try {
      const entries = await readdir(folderDir, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.eml'))
        .map((entry) => entry.name)
        .sort();
    } catch {
      return [];
    }
  }

  /** Reads a message whose journal entry is gone. */
  private async rebuildFromFile(folderDir: string, file: string): Promise<AdoptedMessage | null> {
    let source: Buffer;
    try {
      source = openMessageFile(
        await readFile(join(folderDir, file)),
        this.options.encryptionKey ?? null,
      );
    } catch (error) {
      logger.warn(`Cannot read ${file}: ${(error as Error).message}`);
      return null;
    }

    this.stats.bytesRead += source.length;
    const headers = readHeaders(source);
    const parsed = new Date(headers.date ?? '');
    const internalDate = Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;

    this.synthetic += 1;
    return {
      file,
      // Sequential within the folder, and paired with UIDVALIDITY zero: the
      // next backup replaces both after matching by fingerprint.
      uid: this.synthetic,
      uidvalidity: 0,
      messageId: headers.messageId,
      fingerprint: messageFingerprint({
        messageId: headers.messageId,
        internalDate,
        fromAddress: headers.from,
        subject: headers.subject,
        size: source.length,
      }),
      internalDate: internalDate.toISOString(),
      size: source.length,
      subject: headers.subject,
      from: headers.from,
      to: headers.to,
      flags: [],
    };
  }
}

interface Headers {
  messageId: string | null;
  subject: string | null;
  from: string | null;
  to: string | null;
  date: string | null;
}

/** Reads the handful of headers the index needs, without parsing the body. */
export function readHeaders(source: Buffer): Headers {
  const crlf = source.indexOf('\r\n\r\n');
  const lf = source.indexOf('\n\n');
  const end = crlf === -1 ? lf : crlf;
  const head = source
    .subarray(0, end === -1 ? Math.min(source.length, 64 * 1024) : end)
    .toString('utf8');
  // Unfold: a header continues on the next line when that line is indented.
  const unfolded = head.replace(/\r?\n[ \t]+/g, ' ');

  const find = (name: string): string | null => {
    const match = new RegExp(`^${name}:\\s*(.*)$`, 'im').exec(unfolded);
    return match?.[1]?.trim() || null;
  };

  const address = (value: string | null): string | null => {
    if (!value) return null;
    const angle = /<([^>]+)>/.exec(value);
    return (angle?.[1] ?? value).trim().toLowerCase();
  };

  return {
    messageId: find('Message-ID'),
    subject: find('Subject'),
    from: address(find('From')),
    to: address(find('To')),
    date: find('Date'),
  };
}

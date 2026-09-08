import { mkdir, readdir, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import type { Account } from '../types.js';
import { DELETED_DIR, folderPathSegments, sanitizeSegment } from '../util/paths.js';
import { appendJournal, type JournalRecord } from './journal.js';

/**
 * Layout on disk:
 *
 *   <archive>/<account>/<folder>/<message>.eml
 *   <archive>/<account>/<folder>/.mailarchiver.jsonl
 *   <archive>/<account>/_deleted/<folder>/<message>.eml
 */
export class ArchiveLayout {
  constructor(private readonly baseDir: string) {}

  /** Directory of one account, named after its address. */
  accountDir(account: Pick<Account, 'email' | 'archivePath'>): string {
    if (account.archivePath) return account.archivePath;
    return join(this.baseDir, sanitizeSegment(account.email));
  }

  /** Local folder path relative to the account directory. */
  relativeFolderPath(imapPath: string, delimiter: string): string {
    return folderPathSegments(imapPath, delimiter).join(sep);
  }

  folderDir(account: Pick<Account, 'email' | 'archivePath'>, relativeFolder: string): string {
    return join(this.accountDir(account), relativeFolder);
  }

  deletedDir(account: Pick<Account, 'email' | 'archivePath'>, relativeFolder: string): string {
    return join(this.accountDir(account), DELETED_DIR, relativeFolder);
  }
}

/** Lists the .eml file names present in a folder. */
export async function listMessageFiles(folderDir: string): Promise<Set<string>> {
  try {
    const entries = await readdir(folderDir, { withFileTypes: true });
    return new Set(
      entries.filter((entry) => entry.isFile() && entry.name.endsWith('.eml')).map((entry) => entry.name),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Set();
    throw error;
  }
}

export interface StoredMessage {
  fileName: string;
  bytesWritten: number;
}

/**
 * Writes one message and records it in the folder journal.
 *
 * The file modification time is set to the server side internal date, so the
 * archive sorts correctly in Finder and in any file browser.
 */
export async function storeMessage(
  folderDir: string,
  fileName: string,
  source: Buffer,
  meta: Omit<Extract<JournalRecord, { op: 'add' }>, 'op' | 'ts' | 'file'>,
  internalDate: Date,
): Promise<StoredMessage> {
  await mkdir(folderDir, { recursive: true });
  const target = join(folderDir, fileName);
  const tmp = `${target}.part`;
  await writeFile(tmp, source);
  await rename(tmp, target);

  if (!Number.isNaN(internalDate.getTime())) {
    try {
      await utimes(target, internalDate, internalDate);
    } catch {
      // Not fatal - some network file systems refuse to set times.
    }
  }

  await appendJournal(folderDir, {
    op: 'add',
    ts: new Date().toISOString(),
    file: fileName,
    ...meta,
  });

  return { fileName, bytesWritten: source.length };
}

/** Moves a message file between two folders and journals both sides. */
export async function moveMessageFile(
  sourceDir: string,
  sourceFile: string,
  targetDir: string,
  targetFile: string,
  meta: Omit<Extract<JournalRecord, { op: 'add' }>, 'op' | 'ts' | 'file'>,
  reason: 'moved' | 'deleted',
  relativeTarget: string,
  relativeSource: string,
): Promise<void> {
  await mkdir(targetDir, { recursive: true });
  const from = join(sourceDir, sourceFile);
  const to = join(targetDir, targetFile);

  try {
    await rename(from, to);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    // The file is already gone; keep the bookkeeping consistent anyway.
  }

  await appendJournal(sourceDir, {
    op: 'remove',
    ts: new Date().toISOString(),
    file: sourceFile,
    reason,
    target: relativeTarget,
  });
  await appendJournal(targetDir, {
    op: 'add',
    ts: new Date().toISOString(),
    file: targetFile,
    ...meta,
    movedFrom: relativeSource,
  });
}

export async function recordFlagChange(folderDir: string, fileName: string, flags: string[]): Promise<void> {
  await appendJournal(folderDir, { op: 'flags', ts: new Date().toISOString(), file: fileName, flags });
}

/** Permanently removes a file from the archive (purging `_deleted`). */
export async function purgeMessageFile(folderDir: string, fileName: string): Promise<void> {
  await rm(join(folderDir, fileName), { force: true });
  await appendJournal(folderDir, {
    op: 'remove',
    ts: new Date().toISOString(),
    file: fileName,
    reason: 'purged',
  });
}

/** Moves a whole folder, used when the server renamed or deleted one. */
export async function moveFolderDir(sourceDir: string, targetDir: string): Promise<void> {
  await mkdir(dirname(targetDir), { recursive: true });
  try {
    await rename(sourceDir, targetDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Relative path of a folder inside the account directory, for journal entries. */
export function relativeTo(accountDir: string, folderDir: string): string {
  return relative(accountDir, folderDir) || '.';
}

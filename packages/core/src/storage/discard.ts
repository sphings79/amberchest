import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { ArchiveDatabase, FolderRow, MessageRow } from '../db/database.js';
import type { Account } from '../types.js';
import { logger } from '../util/logger.js';
import { uniqueFileName } from '../util/paths.js';
import { ArchiveLayout, listMessageFiles, moveMessageFile } from './archive.js';
import { appendJournal } from './journal.js';

export interface DiscardResult {
  /** Messages whose index entry is gone. */
  messages: number;
  /** Files handed to another folder rather than deleted, because a message
   *  there was stored as a link to them. */
  handedOver: number;
  bytes: number;
}

/**
 * Removes the local copy of a folder: the files and the index entries.
 *
 * Nothing is touched on the server. This is the counterpart to a person
 * deciding that an archived folder is not worth keeping - a newsletter folder
 * with ten thousand messages, say - and it frees the space that costs.
 *
 * The one thing it must not do is take a file another folder is relying on.
 * A message that lives in two folders is stored once and pointed at from the
 * second, so deleting the folder that happens to hold the bytes would leave
 * the other one with a dangling entry. Those files are handed over first,
 * exactly as a deletion on the server does.
 */
export async function discardFolder(
  db: ArchiveDatabase,
  account: Account,
  folder: FolderRow,
  archiveBaseDir: string,
): Promise<DiscardResult> {
  const layout = new ArchiveLayout(archiveBaseDir);
  const accountDir = layout.accountDir(account);
  const folderDir = join(accountDir, folder.local_path);
  const folders = db.listFolders(account.id);

  const messages = db.listMessagesInFolder(folder.id);
  const result: DiscardResult = { messages: messages.length, handedOver: 0, bytes: 0 };

  for (const message of messages) {
    result.bytes += message.size;
    if (message.linked_to !== null) continue;
    if (await handOver(db, message, folderDir, folder.local_path, accountDir, folders))
      result.handedOver += 1;
  }

  // Whatever is left in the directory goes, including the journal: the folder
  // is not being archived any more, so there is nothing to rebuild from.
  await rm(folderDir, { recursive: true, force: true });

  db.deleteFolderContents(folder.id);

  logger.info(
    `Discarded the local copy of ${folder.path} for ${account.name}: ${result.messages} message(s), ` +
      `${result.handedOver} file(s) handed to another folder`,
    { accountId: account.id },
  );
  return result;
}

/**
 * Moves a file to a folder that was only pointing at it.
 *
 * Returns false when nothing points at it, in which case the file is deleted
 * along with the directory.
 */
async function handOver(
  db: ArchiveDatabase,
  row: MessageRow,
  sourceDir: string,
  sourceLocalPath: string,
  accountDir: string,
  folders: FolderRow[],
): Promise<boolean> {
  const heir = db.listLinks(row.id).find((link) => link.state === 'active');
  if (!heir) return false;

  const heirFolder = folders.find((entry) => entry.id === heir.folder_id);
  if (!heirFolder) return false;

  const targetDir = join(accountDir, heirFolder.local_path);
  const taken = await listMessageFiles(targetDir);
  const fileName = uniqueFileName(row.file_name, taken);

  try {
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
      join(heirFolder.local_path, fileName),
      join(sourceLocalPath, row.file_name),
    );
  } catch (error) {
    logger.warn(
      `Could not hand ${row.file_name} over to ${heirFolder.path}: ${(error as Error).message}`,
    );
    return false;
  }

  db.promoteLink(heir.id, fileName, heir.folder_id);
  return true;
}


/**
 * Throws one message out of the archive and remembers that it was on purpose.
 *
 * The file goes and the row stays as a tombstone, because the mail is still on
 * the server: without the row the next backup would find nothing in the index
 * and fetch it straight back. The journal gets the same decision, so a
 * rebuilt index and an archive that has been moved keep it as well.
 *
 * As with a whole folder, a file another folder was only pointing at is handed
 * over instead of deleted.
 */
export async function discardMessage(
  db: ArchiveDatabase,
  account: Account,
  folder: FolderRow,
  row: MessageRow,
  archiveBaseDir: string,
): Promise<{ handedOver: boolean }> {
  const layout = new ArchiveLayout(archiveBaseDir);
  const accountDir = layout.accountDir(account);
  const folderDir = join(accountDir, folder.local_path);
  const folders = db.listFolders(account.id);

  let handedOver = false;
  if (row.linked_to === null) {
    handedOver = await handOver(db, row, folderDir, folder.local_path, accountDir, folders);
    // Deleted without the usual "removed" record: the discard record below
    // says the same thing and says why, and two entries for one decision only
    // make the journal harder to read.
    if (!handedOver) await rm(join(folderDir, row.file_name), { force: true });
  }

  db.discardMessage(row.id);

  await appendJournal(folderDir, {
    op: 'discard',
    ts: new Date().toISOString(),
    file: row.file_name,
    uid: row.uid,
    uidvalidity: row.uidvalidity,
    messageId: row.message_id,
    fingerprint: row.fingerprint,
    internalDate: row.internal_date,
    size: row.size,
    subject: row.subject,
    from: row.from_addr,
    to: row.to_addr,
  });

  logger.info(`Discarded ${row.subject ?? row.file_name} from ${folder.path}`, {
    accountId: account.id,
  });
  return { handedOver };
}

/** Takes the decision back, in the index and in the journal. */
export async function undiscardMessage(
  db: ArchiveDatabase,
  account: Account,
  archiveBaseDir: string,
  messageId: number,
): Promise<boolean> {
  const folders = db.listFolders(account.id);
  const row = db.undiscardMessage(messageId);
  if (!row) return false;

  const folder = folders.find((entry) => entry.id === row.folder_id);
  if (folder) {
    const layout = new ArchiveLayout(archiveBaseDir);
    await appendJournal(join(layout.accountDir(account), folder.local_path), {
      op: 'undiscard',
      ts: new Date().toISOString(),
      fingerprint: row.fingerprint,
    });
  }
  return true;
}


/**
 * Takes back every decision, or every one within a folder.
 *
 * Each tombstone gets its own journal record, the same as undoing one at a
 * time: leaving them out would mean a rebuilt index restores exactly what was
 * just released.
 */
export async function undiscardAll(
  db: ArchiveDatabase,
  account: Account,
  archiveBaseDir: string,
  folderPath?: string,
): Promise<number> {
  const layout = new ArchiveLayout(archiveBaseDir);
  const accountDir = layout.accountDir(account);
  const folders = db.listFolders(account.id);
  const { rows } = db.listDiscarded(account.id, {
    folderPath,
    limit: Number.MAX_SAFE_INTEGER,
    offset: 0,
  });

  const ts = new Date().toISOString();
  for (const row of rows) {
    const folder = folders.find((entry) => entry.id === row.folder_id);
    if (!folder) continue;
    await appendJournal(join(accountDir, folder.local_path), {
      op: 'undiscard',
      ts,
      fingerprint: row.fingerprint,
    });
  }

  return db.undiscardAll(account.id, folderPath);
}

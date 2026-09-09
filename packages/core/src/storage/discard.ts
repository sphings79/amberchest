import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { ArchiveDatabase, FolderRow, MessageRow } from '../db/database.js';
import type { Account } from '../types.js';
import { logger } from '../util/logger.js';
import { uniqueFileName } from '../util/paths.js';
import { ArchiveLayout, listMessageFiles, moveMessageFile } from './archive.js';

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

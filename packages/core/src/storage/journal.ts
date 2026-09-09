import { createReadStream } from 'node:fs';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { JOURNAL_FILE } from '../util/paths.js';

/**
 * Append-only journal kept inside every archived folder.
 *
 * Together with the .eml files it makes each folder self describing: if the
 * SQLite index is lost, the archive can be rebuilt from disk alone. One line
 * per event keeps writes cheap even for folders with a hundred thousand mails.
 */
export type JournalRecord =
  | {
      /**
       * Written whenever the folder is seen on the server.
       *
       * The directory name alone does not say what the folder is called on the
       * server: with a delimiter other than "/" the two differ. Without this
       * record an archive can only be adopted by asking the server.
       */
      op: 'folder';
      ts: string;
      path: string;
      delimiter: string;
      specialUse: string | null;
      uidvalidity: number | null;
    }
  | {
      op: 'add';
      ts: string;
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
      /** Local folder path the message came from, when it was moved here. */
      movedFrom?: string;
    }
  | { op: 'flags'; ts: string; file: string; flags: string[] }
  | {
      /**
       * The same message, already stored in another folder.
       *
       * Written instead of a second copy of the bytes; `target` is the path of
       * the file that holds them, relative to the account directory.
       */
      op: 'link';
      ts: string;
      file: string;
      target: string;
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
  | {
      op: 'remove';
      ts: string;
      file: string;
      /** Where the file went: another folder, the _deleted tree, or nowhere. */
      reason: 'moved' | 'deleted' | 'purged';
      target?: string;
    }
  | {
      /**
       * Thrown out by a person, not by the server.
       *
       * Its own record rather than another `remove` reason, because it has to
       * carry what recognises the message: the file is gone, and the next
       * backup would otherwise see the mail on the server, find nothing in the
       * index, and fetch it again. Everything needed to say "this one, no"
       * therefore travels with it - which also means a rebuilt index and an
       * archive that was moved keep the decision.
       */
      op: 'discard';
      ts: string;
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
    }
  | {
      /** Takes the decision back, so the next backup fetches the mail again. */
      op: 'undiscard';
      ts: string;
      fingerprint: string;
    };

export function journalPath(folderDir: string): string {
  return join(folderDir, JOURNAL_FILE);
}

export async function appendJournal(folderDir: string, record: JournalRecord): Promise<void> {
  const file = journalPath(folderDir);
  await mkdir(dirname(file), { recursive: true });
  await appendFile(file, `${JSON.stringify(record)}\n`, 'utf8');
}

/** Reads a journal line by line; a truncated last line is ignored. */
export async function readJournal(folderDir: string): Promise<JournalRecord[]> {
  const file = journalPath(folderDir);
  const records: JournalRecord[] = [];
  try {
    const stream = createReadStream(file, { encoding: 'utf8' });
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        records.push(JSON.parse(trimmed) as JournalRecord);
      } catch {
        // Half written line from an interrupted run - skip it.
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return records;
}

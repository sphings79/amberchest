import type { ArchiveDatabase } from '../db/database.js';
import { toMatchExpression } from './query.js';

export interface SearchOptions {
  /** Free text; empty means "everything that matches the other filters". */
  query: string;
  /** Restrict to one account; omitted searches across all of them. */
  accountId?: string | null;
  /** Restrict to these IMAP folder paths. */
  folders?: string[];
  /** ISO dates, inclusive. */
  dateFrom?: string | null;
  dateTo?: string | null;
  /** Substring match on the sender address. */
  from?: string | null;
  /** Only messages that have at least one exported attachment. */
  withAttachments?: boolean;
  limit?: number;
  offset?: number;
}

export interface SearchHit {
  messageId: number;
  accountId: string;
  folderPath: string;
  subject: string | null;
  fromAddr: string | null;
  toAddr: string | null;
  internalDate: string;
  size: number;
  flags: string[];
  attachmentCount: number;
  /** Highlighted excerpt of the body, or null when searching without text. */
  snippet: string | null;
}

export interface SearchResult {
  hits: SearchHit[];
  /** Total number of matches, ignoring limit and offset. */
  total: number;
  /** Set when the query was not usable as a text search. */
  textSearch: boolean;
}

interface Row {
  message_id: number;
  account_id: string;
  folder_path: string;
  subject: string | null;
  from_addr: string | null;
  to_addr: string | null;
  internal_date: string;
  size: number;
  flags: string;
  attachment_count: number;
  snippet: string | null;
}

/**
 * Searches the archive.
 *
 * With a text query this runs against the FTS index and orders by relevance;
 * without one it is a plain filtered listing ordered by date, so the same
 * screen can be used to browse a folder.
 */
export function searchMessages(db: ArchiveDatabase, options: SearchOptions): SearchResult {
  const match = toMatchExpression(options.query);
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 500);
  const offset = Math.max(options.offset ?? 0, 0);

  const where: string[] = ["m.state = 'active'"];
  const params: unknown[] = [];

  if (options.accountId) {
    where.push('m.account_id = ?');
    params.push(options.accountId);
  }
  if (options.folders && options.folders.length > 0) {
    where.push(`f.path IN (${options.folders.map(() => '?').join(',')})`);
    params.push(...options.folders);
  }
  if (options.dateFrom) {
    where.push('m.internal_date >= ?');
    params.push(options.dateFrom);
  }
  if (options.dateTo) {
    // Inclusive end of day.
    where.push('m.internal_date <= ?');
    params.push(`${options.dateTo}T23:59:59.999Z`);
  }
  if (options.from) {
    where.push('m.from_addr LIKE ?');
    params.push(`%${options.from}%`);
  }
  if (options.withAttachments) {
    where.push('EXISTS (SELECT 1 FROM attachments a WHERE a.message_id = m.id)');
  }

  const handle = db.handle;

  if (match) {
    const sql = `
      SELECT m.id AS message_id, m.account_id, f.path AS folder_path, m.subject, m.from_addr,
             m.to_addr, m.internal_date, m.size, m.flags,
             (SELECT COUNT(*) FROM attachments a WHERE a.message_id = m.id) AS attachment_count,
             snippet(message_fts, 3, '<mark>', '</mark>', '…', 12) AS snippet
        FROM message_fts
        JOIN messages m ON m.id = message_fts.rowid
        JOIN folders  f ON f.id = m.folder_id
       WHERE message_fts MATCH ? AND ${where.join(' AND ')}
       ORDER BY bm25(message_fts, 8.0, 4.0, 2.0, 1.0, 1.0)
       LIMIT ? OFFSET ?`;

    const countSql = `
      SELECT COUNT(*) AS total
        FROM message_fts
        JOIN messages m ON m.id = message_fts.rowid
        JOIN folders  f ON f.id = m.folder_id
       WHERE message_fts MATCH ? AND ${where.join(' AND ')}`;

    const rows = handle.prepare(sql).all(match, ...params, limit, offset) as Row[];
    const { total } = handle.prepare(countSql).get(match, ...params) as { total: number };
    return { hits: rows.map(toHit), total, textSearch: true };
  }

  const sql = `
    SELECT m.id AS message_id, m.account_id, f.path AS folder_path, m.subject, m.from_addr,
           m.to_addr, m.internal_date, m.size, m.flags,
           (SELECT COUNT(*) FROM attachments a WHERE a.message_id = m.id) AS attachment_count,
           NULL AS snippet
      FROM messages m
      JOIN folders f ON f.id = m.folder_id
     WHERE ${where.join(' AND ')}
     ORDER BY m.internal_date DESC
     LIMIT ? OFFSET ?`;

  const countSql = `
    SELECT COUNT(*) AS total
      FROM messages m
      JOIN folders f ON f.id = m.folder_id
     WHERE ${where.join(' AND ')}`;

  const rows = handle.prepare(sql).all(...params, limit, offset) as Row[];
  const { total } = handle.prepare(countSql).get(...params) as { total: number };
  return { hits: rows.map(toHit), total, textSearch: false };
}

function toHit(row: Row): SearchHit {
  return {
    messageId: row.message_id,
    accountId: row.account_id,
    folderPath: row.folder_path,
    subject: row.subject,
    fromAddr: row.from_addr,
    toAddr: row.to_addr,
    internalDate: row.internal_date,
    size: row.size,
    flags: JSON.parse(row.flags) as string[],
    attachmentCount: row.attachment_count,
    snippet: row.snippet,
  };
}

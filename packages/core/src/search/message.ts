import { join } from 'node:path';
import { simpleParser, type AddressObject } from 'mailparser';
import type { ArchiveDatabase } from '../db/database.js';
import { ArchiveLayout, readArchiveFile } from '../storage/archive.js';
import type { Account } from '../types.js';

export interface MessageAttachmentInfo {
  index: number;
  name: string;
  contentType: string | null;
  size: number;
  inline: boolean;
}

export interface MessageContent {
  id: number;
  accountId: string;
  folderPath: string;
  subject: string | null;
  from: string | null;
  to: string | null;
  cc: string | null;
  date: string;
  flags: string[];
  size: number;
  /** Body as HTML, with embedded images already inlined as data URIs. */
  html: string | null;
  text: string | null;
  attachments: MessageAttachmentInfo[];
  /** Absolute path of the .eml file, for "open in mail client". */
  filePath: string;
  /** True when the HTML refers to resources on the internet. */
  hasRemoteContent: boolean;
}

/** Inline images below this size are embedded; bigger ones are left out. */
const MAX_INLINE_BYTES = 2 * 1024 * 1024;

function addressText(value: AddressObject | AddressObject[] | undefined): string | null {
  if (!value) return null;
  const list = Array.isArray(value) ? value : [value];
  const text = list.map((entry) => entry.text).filter(Boolean).join(', ');
  return text || null;
}

/** Rewrites cid: references to data URIs so the viewer needs no server calls. */
function inlineEmbeddedImages(
  html: string,
  attachments: Array<{ cid?: string; contentType?: string; content: Buffer; size: number }>,
): string {
  let result = html;
  for (const attachment of attachments) {
    if (!attachment.cid) continue;
    if (attachment.size > MAX_INLINE_BYTES) continue;
    const dataUri = `data:${attachment.contentType ?? 'application/octet-stream'};base64,${attachment.content.toString('base64')}`;
    // cid references appear with and without angle brackets, quoted or not.
    const escaped = attachment.cid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(`cid:${escaped}`, 'gi'), dataUri);
  }
  return result;
}

const REMOTE_PATTERN = /(?:src|background)\s*=\s*["']?https?:\/\//i;

export interface MessageLoaderOptions {
  db: ArchiveDatabase;
  archiveBaseDir: string;
  /** Needed when the archive is encrypted; ignored for plain files. */
  encryptionKey?: Buffer | null;
}

/** Locates the .eml file of a message and parses it for the viewer. */
export async function loadMessage(
  account: Account,
  messageId: number,
  options: MessageLoaderOptions,
): Promise<MessageContent> {
  const row = options.db.getMessage(messageId);
  if (!row || row.account_id !== account.id) throw new Error('Unknown message');

  // A message that sits in several folders keeps its bytes in one of them.
  const owner = options.db.resolveFile(row);
  const folder = options.db.listFolders(account.id).find((entry) => entry.id === owner.folder_id);
  if (!folder) throw new Error('Unknown folder');

  const layout = new ArchiveLayout(options.archiveBaseDir);
  const base = owner.state === 'deleted'
    ? layout.deletedDir(account, folder.local_path)
    : join(layout.accountDir(account), folder.local_path);
  const filePath = join(base, owner.file_name);

  const source = await readArchiveFile(filePath, options.encryptionKey ?? null);
  const parsed = await simpleParser(source, { skipTextLinks: true });

  const attachments = parsed.attachments.map((attachment, index) => ({
    index,
    name: attachment.filename ?? `attachment-${index + 1}`,
    contentType: attachment.contentType ?? null,
    size: attachment.size ?? 0,
    inline: attachment.related === true || attachment.contentDisposition === 'inline',
  }));

  const rawHtml = typeof parsed.html === 'string' ? parsed.html : null;
  const html = rawHtml
    ? inlineEmbeddedImages(
        rawHtml,
        parsed.attachments.map((attachment) => ({
          cid: attachment.cid,
          contentType: attachment.contentType,
          content: attachment.content as Buffer,
          size: attachment.size ?? 0,
        })),
      )
    : null;

  return {
    id: row.id,
    accountId: account.id,
    folderPath: folder.path,
    subject: parsed.subject ?? row.subject,
    from: addressText(parsed.from) ?? row.from_addr,
    to: addressText(parsed.to) ?? row.to_addr,
    cc: addressText(parsed.cc),
    date: (parsed.date ?? new Date(row.internal_date)).toISOString(),
    flags: JSON.parse(row.flags) as string[],
    size: row.size,
    html,
    text: parsed.text ?? null,
    attachments,
    filePath,
    hasRemoteContent: html ? REMOTE_PATTERN.test(html) : false,
  };
}

export interface LoadedAttachment {
  name: string;
  contentType: string;
  content: Buffer;
}

/** Reads one attachment straight out of the stored message. */
export async function loadAttachment(
  account: Account,
  messageId: number,
  index: number,
  options: MessageLoaderOptions,
): Promise<LoadedAttachment> {
  const message = await loadMessageSource(account, messageId, options);
  const parsed = await simpleParser(message.source, { skipTextLinks: true });
  const attachment = parsed.attachments[index];
  if (!attachment) throw new Error('Unknown attachment');

  return {
    name: attachment.filename ?? `attachment-${index + 1}`,
    contentType: attachment.contentType ?? 'application/octet-stream',
    content: attachment.content as Buffer,
  };
}

/** Raw bytes of the stored message, for download and "open in mail client". */
export async function loadMessageSource(
  account: Account,
  messageId: number,
  options: MessageLoaderOptions,
): Promise<{ source: Buffer; filePath: string; fileName: string }> {
  const row = options.db.getMessage(messageId);
  if (!row || row.account_id !== account.id) throw new Error('Unknown message');

  // A message that sits in several folders keeps its bytes in one of them.
  const owner = options.db.resolveFile(row);
  const folder = options.db.listFolders(account.id).find((entry) => entry.id === owner.folder_id);
  if (!folder) throw new Error('Unknown folder');

  const layout = new ArchiveLayout(options.archiveBaseDir);
  const base = owner.state === 'deleted'
    ? layout.deletedDir(account, folder.local_path)
    : join(layout.accountDir(account), folder.local_path);
  const filePath = join(base, owner.file_name);

  return {
    source: await readArchiveFile(filePath, options.encryptionKey ?? null),
    filePath,
    fileName: row.file_name,
  };
}

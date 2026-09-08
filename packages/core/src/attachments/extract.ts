import { simpleParser } from 'mailparser';
import { sha256 } from '../util/hash.js';
import { sanitizeSegment } from '../util/paths.js';

export interface ExtractedAttachment {
  /** File system safe name, derived from the name in the message. */
  fileName: string;
  /** Name exactly as it appeared in the message, for the manifest. */
  originalName: string;
  contentType: string | null;
  size: number;
  sha256: string;
  /**
   * True for parts that are displayed inside the message body - signature
   * logos, embedded screenshots. Usually not what a human means by
   * "attachment", so they are filtered out by default.
   */
  inline: boolean;
  content: Buffer;
}

/** Extension guessed from the content type, for parts without a file name. */
const TYPE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/html': 'html',
  'text/calendar': 'ics',
  'application/zip': 'zip',
  'application/json': 'json',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
};

function fallbackName(index: number, contentType: string | null): string {
  const extension = contentType ? TYPE_EXTENSIONS[contentType.toLowerCase()] : undefined;
  return `attachment-${index + 1}${extension ? `.${extension}` : ''}`;
}

/**
 * Makes an attachment name safe to write.
 *
 * `sanitizeSegment` already removes path separators, so `../../etc/passwd`
 * cannot escape the target directory. Leading dots are dropped on top of that:
 * an attachment should not end up as a hidden file.
 */
function safeFileName(name: string): string {
  const cleaned = sanitizeSegment(name).replace(/^\.+/, '');
  return cleaned === '' || cleaned === '_' ? 'attachment' : cleaned;
}

/** Reads all attachment parts out of one RFC 5322 message. */
export async function extractAttachments(source: Buffer): Promise<ExtractedAttachment[]> {
  const parsed = await simpleParser(source, {
    skipHtmlToText: true,
    skipTextToHtml: true,
    skipTextLinks: true,
  });

  return parsed.attachments.map((attachment, index) => {
    const content = Buffer.isBuffer(attachment.content)
      ? attachment.content
      : Buffer.from(attachment.content as unknown as ArrayBuffer);
    const contentType = attachment.contentType ?? null;
    const originalName = attachment.filename ?? fallbackName(index, contentType);

    return {
      fileName: safeFileName(originalName),
      originalName,
      contentType,
      size: content.length,
      sha256: sha256(content),
      // `related` marks parts referenced from the HTML body via cid:.
      inline: attachment.related === true || attachment.contentDisposition === 'inline',
      content,
    };
  });
}

/** Lower-cased extension without the dot, or an empty string. */
export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0 || dot === fileName.length - 1) return '';
  return fileName.slice(dot + 1).toLowerCase();
}

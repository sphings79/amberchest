import { gunzipSync, inflateRawSync } from 'node:zlib';
import { logger } from '../util/logger.js';

/**
 * Plain text extraction for attachment content.
 *
 * PDFs go through unpdf (Mozilla's pdf.js, no native parts). Office files are
 * ZIP containers holding XML, which Node can open with its built-in zlib, so
 * they need no extra dependency - the result is rougher than a dedicated
 * library would give, but good enough to find a word again.
 */

const MAX_TEXT_LENGTH = 200_000;

/** Guard rails against archive bombs. */
const ARCHIVE_LIMITS = {
  maxEntries: 200,
  maxTotalBytes: 50 * 1024 * 1024,
  maxEntryBytes: 10 * 1024 * 1024,
} as const;

const ARCHIVE_EXTENSIONS = ['zip', 'tar', 'gz', 'tgz'];

const OFFICE_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);

const PLAIN_TYPES = new Set([
  'text/plain',
  'text/csv',
  'text/markdown',
  'text/html',
  'application/json',
  'application/xml',
  'text/xml',
]);

/** True when this content type can yield searchable text at all. */
export function isExtractable(contentType: string | null, fileName: string): boolean {
  const type = (contentType ?? '').toLowerCase();
  if (type === 'application/pdf') return true;
  if (OFFICE_TYPES.has(type)) return true;
  if (PLAIN_TYPES.has(type)) return true;

  const extension = fileName.toLowerCase().split('.').pop() ?? '';
  return [
    'pdf', 'docx', 'xlsx', 'pptx', 'txt', 'csv', 'md', 'json', 'xml', 'html',
    ...ARCHIVE_EXTENSIONS,
  ].includes(extension);
}

function clamp(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > MAX_TEXT_LENGTH ? collapsed.slice(0, MAX_TEXT_LENGTH) : collapsed;
}

/** Strips XML tags and decodes the handful of entities that matter. */
function xmlToText(xml: string): string {
  return xml
    // Keep word and paragraph boundaries from turning into run-on text.
    .replace(/<\/(w:p|w:tab|a:p|text:p)>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/**
 * Minimal ZIP reader: walks the central directory and inflates the entries
 * whose names look like document content.
 */
function readZipEntries(buffer: Buffer, wanted: (name: string) => boolean): string[] {
  const results: string[] = [];

  // End of central directory record, searched from the back.
  let eocd = -1;
  for (let index = buffer.length - 22; index >= 0 && index > buffer.length - 66_000; index -= 1) {
    if (buffer.readUInt32LE(index) === 0x06054b50) {
      eocd = index;
      break;
    }
  }
  if (eocd < 0) return results;

  const entryCount = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);

  for (let entry = 0; entry < entryCount; entry += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) break;

    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);

    offset += 46 + nameLength + extraLength + commentLength;
    if (!wanted(name)) continue;

    // Local file header: the real data starts after its variable length parts.
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) continue;
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const data = buffer.subarray(dataStart, dataStart + compressedSize);

    try {
      // 0 = stored, 8 = deflate. ZIP holds raw deflate without a zlib header,
      // so inflateRaw is the right call here, not unzip.
      if (method === 0) results.push(data.toString('utf8'));
      else if (method === 8) results.push(inflateRawSync(data).toString('utf8'));
    } catch {
      // Damaged entry - skip it, the rest of the document may still work.
    }
  }

  return results;
}

function officeToText(buffer: Buffer): string {
  const parts = readZipEntries(
    buffer,
    (name) =>
      name === 'word/document.xml' ||
      name.startsWith('ppt/slides/slide') ||
      name === 'xl/sharedStrings.xml' ||
      name.startsWith('xl/worksheets/sheet'),
  );
  return clamp(parts.map(xmlToText).join(' '));
}

async function pdfToText(buffer: Buffer): Promise<string> {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const document = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(document, { mergePages: true });
  return clamp(Array.isArray(text) ? text.join(' ') : text);
}

interface ArchiveEntry {
  name: string;
  content: Buffer;
}

/** Lists the entries of a ZIP with their raw content. */
function readZipFiles(buffer: Buffer): ArchiveEntry[] {
  const entries: ArchiveEntry[] = [];
  let total = 0;

  let eocd = -1;
  for (let index = buffer.length - 22; index >= 0 && index > buffer.length - 66_000; index -= 1) {
    if (buffer.readUInt32LE(index) === 0x06054b50) {
      eocd = index;
      break;
    }
  }
  if (eocd < 0) return entries;

  const count = Math.min(buffer.readUInt16LE(eocd + 10), ARCHIVE_LIMITS.maxEntries);
  let offset = buffer.readUInt32LE(eocd + 16);

  for (let entry = 0; entry < count; entry += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) break;

    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;

    if (name.endsWith('/')) continue;
    if (uncompressedSize > ARCHIVE_LIMITS.maxEntryBytes) continue;
    if (total + uncompressedSize > ARCHIVE_LIMITS.maxTotalBytes) break;

    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) continue;
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const data = buffer.subarray(dataStart, dataStart + compressedSize);

    try {
      const content = method === 0 ? data : method === 8 ? inflateRawSync(data) : null;
      if (!content) continue;
      total += content.length;
      entries.push({ name, content });
    } catch {
      // Damaged entry - the rest of the archive may still be readable.
    }
  }

  return entries;
}

/** Reads a (possibly gzipped) tar archive. */
function readTarFiles(input: Buffer): ArchiveEntry[] {
  let buffer = input;
  // gzip magic number.
  if (buffer.length > 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) {
    try {
      buffer = gunzipSync(buffer, { maxOutputLength: ARCHIVE_LIMITS.maxTotalBytes });
    } catch {
      return [];
    }
  }

  const entries: ArchiveEntry[] = [];
  let offset = 0;
  let total = 0;

  while (offset + 512 <= buffer.length && entries.length < ARCHIVE_LIMITS.maxEntries) {
    const header = buffer.subarray(offset, offset + 512);
    // Two consecutive zero blocks mark the end of the archive.
    if (header.every((byte) => byte === 0)) break;

    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '').trim();
    const sizeField = header.subarray(124, 136).toString('ascii').replace(/\0.*$/, '').trim();
    const size = Number.parseInt(sizeField, 8);
    const type = String.fromCharCode(header[156] ?? 0);

    if (!Number.isFinite(size) || size < 0) break;
    const dataStart = offset + 512;
    // Entries are padded to a multiple of 512 bytes.
    offset = dataStart + Math.ceil(size / 512) * 512;

    // '0' and '\0' are regular files; everything else is a directory or link.
    if ((type === '0' || type === '\0' || type === '') && name && size <= ARCHIVE_LIMITS.maxEntryBytes) {
      if (total + size > ARCHIVE_LIMITS.maxTotalBytes) break;
      total += size;
      entries.push({ name, content: buffer.subarray(dataStart, dataStart + size) });
    }
  }

  return entries;
}

/**
 * Reads text out of the files inside an archive.
 *
 * Only one level deep: an archive inside an archive contributes its file name
 * and nothing else. That keeps a nested bomb from unfolding.
 */
async function archiveToText(buffer: Buffer, fileName: string): Promise<string> {
  const extension = fileName.toLowerCase().split('.').pop() ?? '';
  const isTar = extension === 'tar' || extension === 'tgz' || fileName.toLowerCase().endsWith('.tar.gz');
  const entries = isTar || extension === 'gz' ? readTarFiles(buffer) : readZipFiles(buffer);

  const parts: string[] = [];
  for (const entry of entries) {
    // File names are always indexed - often the most useful part anyway.
    parts.push(entry.name);

    const entryExtension = entry.name.toLowerCase().split('.').pop() ?? '';
    if (ARCHIVE_EXTENSIONS.includes(entryExtension)) continue;
    if (!isExtractable(null, entry.name)) continue;

    const text = await extractText(entry.content, null, entry.name);
    if (text) parts.push(text);
  }

  return clamp(parts.join(' '));
}

/** Extracts searchable text from one attachment; returns '' when it cannot. */
export async function extractText(
  buffer: Buffer,
  contentType: string | null,
  fileName: string,
): Promise<string> {
  const type = (contentType ?? '').toLowerCase();
  const extension = fileName.toLowerCase().split('.').pop() ?? '';

  try {
    if (type === 'application/pdf' || extension === 'pdf') return await pdfToText(buffer);
    if (OFFICE_TYPES.has(type) || ['docx', 'xlsx', 'pptx'].includes(extension)) {
      return officeToText(buffer);
    }
    if (PLAIN_TYPES.has(type) || ['txt', 'csv', 'md', 'json', 'xml', 'html'].includes(extension)) {
      const text = buffer.toString('utf8');
      return clamp(extension === 'html' || type === 'text/html' ? xmlToText(text) : text);
    }
    if (ARCHIVE_EXTENSIONS.includes(extension) || fileName.toLowerCase().endsWith('.tar.gz')) {
      return await archiveToText(buffer, fileName);
    }
  } catch (error) {
    logger.debug(`Cannot extract text from ${fileName}: ${(error as Error).message}`);
  }

  return '';
}

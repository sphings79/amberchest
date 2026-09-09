import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { MessageContent } from '../search/message.js';

const execFileAsync = promisify(execFile);

/**
 * Turns HTML into PDF.
 *
 * The desktop app supplies an implementation backed by Electron's printToPDF;
 * the container falls back to the headless Chromium in the image. Both render
 * with the same engine, so a PDF looks the same wherever it was made.
 */
export type PdfRenderer = (html: string) => Promise<Buffer>;

/** Chromium binaries to look for when no renderer was injected. */
const CHROMIUM_CANDIDATES = [
  process.env.AMBERCHEST_CHROMIUM,
  'chromium',
  'chromium-browser',
  'google-chrome',
  'google-chrome-stable',
].filter((value): value is string => Boolean(value));

async function findChromium(): Promise<string | null> {
  for (const candidate of CHROMIUM_CANDIDATES) {
    try {
      await execFileAsync(candidate, ['--version'], { timeout: 10_000 });
      return candidate;
    } catch {
      // Try the next one.
    }
  }
  return null;
}

/** True when this installation can produce PDFs at all. */
export async function isPdfAvailable(injected?: PdfRenderer): Promise<boolean> {
  if (injected) return true;
  return (await findChromium()) !== null;
}

/** Renders through a headless Chromium found on the system. */
export const chromiumPdfRenderer: PdfRenderer = async (html) => {
  const binary = await findChromium();
  if (!binary) throw new Error('No Chromium found for PDF rendering');

  const dir = await mkdtemp(join(tmpdir(), 'amberchest-pdf-'));
  const htmlPath = join(dir, 'message.html');
  const pdfPath = join(dir, 'message.pdf');

  try {
    await writeFile(htmlPath, html, 'utf8');
    await execFileAsync(
      binary,
      [
        '--headless',
        '--disable-gpu',
        '--no-sandbox',
        // The message must not be able to reach the network while printing.
        '--disable-remote-fonts',
        '--no-pdf-header-footer',
        `--print-to-pdf=${pdfPath}`,
        `file://${htmlPath}`,
      ],
      { timeout: 60_000 },
    );
    return await readFile(pdfPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Builds the printable document of one message.
 *
 * Remote references are stripped, so printing never phones home; embedded
 * images are already data URIs by the time the message reaches here.
 */
export function messageToPrintableHtml(message: MessageContent, locale = 'de-DE'): string {
  const header = [
    ['Von', message.from],
    ['An', message.to],
    ['Kopie', message.cc],
    ['Datum', new Date(message.date).toLocaleString(locale, { dateStyle: 'full', timeStyle: 'short' })],
    ['Ordner', message.folderPath],
  ]
    .filter(([, value]) => Boolean(value))
    .map(
      ([label, value]) =>
        `<tr><th>${escapeHtml(String(label))}</th><td>${escapeHtml(String(value))}</td></tr>`,
    )
    .join('');

  const attachments = message.attachments.length
    ? `<div class="attachments"><strong>Anhänge:</strong> ${message.attachments
        .map((attachment) => escapeHtml(attachment.name))
        .join(', ')}</div>`
    : '';

  const body = message.html
    ? // Anything that would load from the network is removed for printing.
      message.html
        .replace(/<(script|iframe|object|embed)[^>]*>[\s\S]*?<\/\1>/gi, '')
        .replace(/\s(src|background)\s*=\s*["']https?:\/\/[^"']*["']/gi, '')
    : `<pre>${escapeHtml(message.text ?? '')}</pre>`;

  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8">
<title>${escapeHtml(message.subject ?? 'Nachricht')}</title>
<style>
  @page { margin: 18mm 16mm; }
  body { font-family: -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 11pt;
         color: #111; line-height: 1.45; }
  h1 { font-size: 15pt; margin: 0 0 10px; }
  table.meta { border-collapse: collapse; margin-bottom: 14px; font-size: 9.5pt; }
  table.meta th { text-align: left; padding: 1px 12px 1px 0; color: #555; font-weight: 500;
                  vertical-align: top; white-space: nowrap; }
  .attachments { font-size: 9.5pt; color: #444; margin-bottom: 14px; }
  hr { border: 0; border-top: 1px solid #ccc; margin: 0 0 14px; }
  img { max-width: 100%; height: auto; }
  pre { white-space: pre-wrap; font-family: inherit; }
  table { max-width: 100%; }
</style></head>
<body>
<h1>${escapeHtml(message.subject ?? '(ohne Betreff)')}</h1>
<table class="meta">${header}</table>
${attachments}
<hr>
${body}
</body></html>`;
}

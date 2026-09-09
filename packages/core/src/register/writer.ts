import { mkdir, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import type { ArchiveDatabase } from '../db/database.js';
import { ArchiveLayout } from '../storage/archive.js';
import type { Account } from '../types.js';
import { logger } from '../util/logger.js';

export interface RegisterResult {
  /** Where the top level page was written. */
  indexPath: string;
  folders: number;
  messages: number;
}

const STYLE = `:root{color-scheme:light dark}
*{box-sizing:border-box}
body{margin:0;padding:2rem 1.5rem;font:14px/1.5 ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif;
background:#0d0f14;color:#e8eaf0}
@media (prefers-color-scheme: light){body{background:#f4f6fb;color:#131722}}
a{color:#7c5cff;text-decoration:none}
a:hover{text-decoration:underline}
h1{font-size:1.35rem;margin:0 0 .25rem}
p.sub{margin:0 0 1.5rem;color:#9aa2b5}
table{width:100%;border-collapse:collapse}
th{text-align:left;font-size:.72rem;letter-spacing:.04em;text-transform:uppercase;color:#9aa2b5;
padding:0 .6rem .5rem;font-weight:500}
td{padding:.45rem .6rem;border-top:1px solid #262c3a;vertical-align:top}
@media (prefers-color-scheme: light){td{border-color:#dde2ee}}
td.size,td.date{white-space:nowrap;color:#9aa2b5;font-variant-numeric:tabular-nums}
.note{margin:1.5rem 0 0;padding:.75rem 1rem;border-radius:.6rem;background:#221d3d;color:#c9c2ff;font-size:.85rem}
@media (prefers-color-scheme: light){.note{background:#ede9ff;color:#4c3fb0}}`;

function escape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function bytes(value: number): string {
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = value / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(size < 10 ? 1 : 0)} ${units[unit]}`;
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="de">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<style>${STYLE}</style>
${body}
`;
}

/**
 * Writes a plain HTML index into the archive.
 *
 * The point of keeping mail as .eml files is that they outlive the program
 * that wrote them. A register makes that real: one page per folder, linking to
 * the files next to it, readable in any browser from a plain directory - no
 * server, no database, no AmberChest.
 */
export async function writeRegister(
  account: Account,
  options: {
    db: ArchiveDatabase;
    archiveBaseDir: string;
    /** Files are unreadable without the master password; say so on the page. */
    encrypted?: boolean;
    locale?: string;
  },
): Promise<RegisterResult> {
  const layout = new ArchiveLayout(options.archiveBaseDir);
  const accountDir = layout.accountDir(account);
  const folders = options.db.listFolders(account.id);
  const written: Array<{ path: string; local: string; messages: number; bytes: number }> = [];
  let total = 0;

  for (const folder of folders) {
    const messages = options.db.listMessagesForVerify(account.id, false).filter(
      (message) => message.local_path === folder.local_path,
    );
    if (messages.length === 0) continue;

    const rows = messages
      .map((message) => {
        const date = new Date(message.internal_date);
        const shown = Number.isNaN(date.getTime())
          ? message.internal_date
          : date.toLocaleString(options.locale ?? 'de-DE', {
              dateStyle: 'medium',
              timeStyle: 'short',
            });
        // A linked message keeps its bytes elsewhere; the file next to this
        // page is the one to link to, and it is not there.
        const name = escape(message.file_name);
        const subject = escape(message.subject ?? '(kein Betreff)');
        const link = message.linked_to ? subject : `<a href="./${name}">${subject}</a>`;
        return `<tr><td>${link}</td><td class="date">${escape(shown)}</td>` +
          `<td class="size">${bytes(message.size)}</td></tr>`;
      })
      .join('\n');

    const depth = folder.local_path.split(sep).length;
    const up = '../'.repeat(depth);
    const body = `<h1>${escape(folder.path)}</h1>
<p class="sub">${messages.length} Nachrichten · <a href="${up}index.html">zurück zur Übersicht</a></p>
<table><thead><tr><th>Betreff</th><th>Datum</th><th>Größe</th></tr></thead>
<tbody>
${rows}
</tbody></table>${
      options.encrypted
        ? '<p class="note">Dieses Archiv ist verschlüsselt. Die Dateien lassen sich nur mit dem Master-Passwort in AmberChest öffnen.</p>'
        : ''
    }`;

    const folderDir = join(accountDir, folder.local_path);
    await mkdir(folderDir, { recursive: true });
    await writeFile(join(folderDir, 'index.html'), page(folder.path, body), 'utf8');

    const size = messages.reduce((sum, message) => sum + message.size, 0);
    written.push({
      path: folder.path,
      local: relative(accountDir, folderDir).split(sep).join('/'),
      messages: messages.length,
      bytes: size,
    });
    total += messages.length;
  }

  const list = written
    .sort((a, b) => a.path.localeCompare(b.path))
    .map(
      (folder) =>
        `<tr><td><a href="./${escape(folder.local)}/index.html">${escape(folder.path)}</a></td>` +
        `<td class="size">${folder.messages}</td><td class="size">${bytes(folder.bytes)}</td></tr>`,
    )
    .join('\n');

  const overview = `<h1>${escape(account.name)}</h1>
<p class="sub">${escape(account.email)} · ${total} Nachrichten in ${written.length} Ordnern · Stand ${escape(
    new Date().toLocaleString(options.locale ?? 'de-DE', { dateStyle: 'medium', timeStyle: 'short' }),
  )}</p>
<table><thead><tr><th>Ordner</th><th>Nachrichten</th><th>Größe</th></tr></thead>
<tbody>
${list}
</tbody></table>
<p class="note">Diese Seiten sind ein Verzeichnis der Dateien daneben. Jede Nachricht ist eine
gewöhnliche .eml-Datei und lässt sich mit jedem Mailprogramm öffnen — auch ohne AmberChest.</p>`;

  const indexPath = join(accountDir, 'index.html');
  await mkdir(accountDir, { recursive: true });
  await writeFile(indexPath, page(account.name, overview), 'utf8');

  logger.info(`Register written for ${account.name}: ${written.length} folder(s), ${total} messages`);
  return { indexPath, folders: written.length, messages: total };
}

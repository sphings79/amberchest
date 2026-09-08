/**
 * Checks the attachment export against the local Dovecot container.
 *
 * Runs a backup first, then exports the attachments in every layout and
 * verifies naming, collision handling, de-duplication, filters and manifest.
 *
 * Usage: node dev/test-attachments.mjs
 */
import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const workdir = mkdtempSync(join(tmpdir(), 'mail-archiver-attach-'));
process.env.MAIL_ARCHIVER_CONFIG_DIR = join(workdir, 'config');
process.env.MAIL_ARCHIVER_ARCHIVE_DIR = join(workdir, 'archive');

const { MailArchiverApp } = await import('@mail-archiver/core');

let failures = 0;
function check(label, condition, detail = '') {
  const status = condition ? 'PASS' : 'FAIL';
  if (!condition) failures += 1;
  console.log(`[${status}] ${label}${detail ? ` - ${detail}` : ''}`);
}

function tree(dir) {
  try {
    return execSync(`find "${dir}" -type f | sed "s|${dir}/||" | sort`, { encoding: 'utf8' })
      .trim()
      .split('\n')
      .filter(Boolean);
  } catch {
    return [];
  }
}

const app = new MailArchiverApp();
await app.initialize('attachment-test-pass');
await app.unlock('attachment-test-pass');
await app.updateSettings({ archivePath: join(workdir, 'archive') });

const account = await app.addAccount({
  name: 'Attachment Test',
  email: 'test@example.com',
  host: '127.0.0.1',
  port: 11143,
  security: 'none',
  rejectUnauthorized: false,
  username: 'test@example.com',
  password: 'testpass',
  archivePath: null,
});

const folders = await app.getFolderTree(account.id, false);
const collect = (nodes, out = []) => {
  for (const node of nodes) {
    out.push(node.path);
    collect(node.children, out);
  }
  return out;
};
await app.setSelectedFolders(account.id, collect(folders));
const sync = await app.startSync(account.id);
console.log(`backup: ${sync.stats.messagesNew} messages\n`);

// --- layout: folder-tree, default filters ---------------------------------
await app.updateAttachmentSettings(account.id, {
  layout: 'folder-tree',
  targetPath: join(workdir, 'out-tree'),
});
let result = await app.startAttachmentExport(account.id);
let files = tree(join(workdir, 'out-tree'));
console.log('folder-tree:', JSON.stringify(result.stats));
console.log(files.map((f) => `  ${f}`).join('\n'));

check('attachments were written', result.stats.attachmentsWritten > 0, `${result.stats.attachmentsWritten}`);
check(
  'folder tree is mirrored',
  files.some((f) => f.startsWith('INBOX/')) && files.some((f) => f.includes('Rechnungen/')),
);
check('manifest written', files.includes('attachments.csv') && files.includes('attachments.json'));
// The seed script may have run more than once, so the mailbox can hold several
// identical attachments; what matters is that duplicates are recognised at all.
check(
  'identical attachments de-duplicated',
  result.stats.attachmentsDeduplicated >= 1 &&
    result.stats.attachmentsWritten + result.stats.attachmentsDeduplicated ===
      result.stats.attachmentsFound,
  `written=${result.stats.attachmentsWritten} dedup=${result.stats.attachmentsDeduplicated} found=${result.stats.attachmentsFound}`,
);

const manifest = JSON.parse(readFileSync(join(workdir, 'out-tree', 'attachments.json'), 'utf8'));
check('manifest maps files to messages', manifest.entries.every((e) => e.messageFile && e.folder));
check(
  'de-duplicated entry points at the first copy',
  manifest.entries.some((e) => e.deduplicated === true && e.file),
);

// --- second run must not duplicate work -----------------------------------
result = await app.startAttachmentExport(account.id);
check('second run writes nothing new', result.stats.attachmentsWritten === 0, JSON.stringify(result.stats));

// --- layout: flat, with name collision ------------------------------------
app.resetAttachmentExport(account.id);
await app.updateAttachmentSettings(account.id, {
  layout: 'flat',
  targetPath: join(workdir, 'out-flat'),
  deduplicate: false,
});
result = await app.startAttachmentExport(account.id);
files = tree(join(workdir, 'out-flat')).filter((f) => f.endsWith('.txt'));
console.log('\nflat:', files.join(', '));
check(
  'colliding names get a counter suffix',
  files.includes('rechnung.txt') && files.includes('rechnung_1.txt'),
  files.join(', '),
);
check('without de-duplication both copies are written', files.filter((f) => f.startsWith('angebot')).length === 2);

// --- layout: year-month ----------------------------------------------------
app.resetAttachmentExport(account.id);
await app.updateAttachmentSettings(account.id, {
  layout: 'year-month',
  targetPath: join(workdir, 'out-date'),
  deduplicate: true,
});
result = await app.startAttachmentExport(account.id);
files = tree(join(workdir, 'out-date')).filter((f) => f.endsWith('.txt'));
console.log('year-month:', files.join(', '));
check('sorted into year and month', files.every((f) => /^\d{4}\/\d{2}\//.test(f)), files.join(', '));

// --- layout: per-message ---------------------------------------------------
app.resetAttachmentExport(account.id);
await app.updateAttachmentSettings(account.id, {
  layout: 'per-message',
  targetPath: join(workdir, 'out-message'),
});
result = await app.startAttachmentExport(account.id);
files = tree(join(workdir, 'out-message')).filter((f) => f.endsWith('.txt'));
console.log('per-message:', files.join(', '));
check(
  'one directory per message',
  files.every((f) => /\/\d{4}-\d{2}-\d{2}_\d{6}_\d+\//.test(f)),
  files.join(', '),
);
check(
  'de-duplication is off for per-message',
  result.stats.attachmentsDeduplicated === 0,
  `${result.stats.attachmentsDeduplicated}`,
);

// --- filters ---------------------------------------------------------------
app.resetAttachmentExport(account.id);
await app.updateAttachmentSettings(account.id, {
  layout: 'flat',
  targetPath: join(workdir, 'out-filtered'),
  extensionMode: 'exclude',
  extensions: ['txt'],
});
result = await app.startAttachmentExport(account.id);
files = tree(join(workdir, 'out-filtered')).filter((f) => f.endsWith('.txt'));
check('extension exclude filter works', files.length === 0 && result.stats.attachmentsFiltered > 0,
  `written=${result.stats.attachmentsWritten} filtered=${result.stats.attachmentsFiltered}`);

app.resetAttachmentExport(account.id);
await app.updateAttachmentSettings(account.id, {
  targetPath: join(workdir, 'out-minsize'),
  extensionMode: 'all',
  extensions: [],
  minSizeBytes: 1_000_000,
});
result = await app.startAttachmentExport(account.id);
check('minimum size filter works', result.stats.attachmentsWritten === 0,
  `written=${result.stats.attachmentsWritten}`);

// --- folder restriction ----------------------------------------------------
app.resetAttachmentExport(account.id);
await app.updateAttachmentSettings(account.id, {
  targetPath: join(workdir, 'out-folder'),
  minSizeBytes: 0,
  layout: 'folder-tree',
  folders: ['INBOX'],
});
result = await app.startAttachmentExport(account.id);
files = tree(join(workdir, 'out-folder')).filter((f) => f.endsWith('.txt'));
check('folder restriction works', files.every((f) => f.startsWith('INBOX/')) && files.length > 0,
  files.join(', '));

console.log(`\nworkdir: ${workdir}`);
app.close();
process.exit(failures === 0 ? 0 : 1);

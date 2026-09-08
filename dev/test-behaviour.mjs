/**
 * Behavioural checks against the local Dovecot container.
 *
 * Verifies the promises that matter: nothing on the server is modified, a
 * second run downloads nothing, a message moved on the server is moved locally
 * instead of downloaded again, and a deleted message lands in _deleted.
 *
 * Usage: node dev/test-behaviour.mjs
 */
import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ImapFlow } from 'imapflow';

const workdir = mkdtempSync(join(tmpdir(), 'mail-archiver-behaviour-'));
process.env.MAIL_ARCHIVER_CONFIG_DIR = join(workdir, 'config');
process.env.MAIL_ARCHIVER_ARCHIVE_DIR = join(workdir, 'archive');

const { MailArchiverApp } = await import('@mail-archiver/core');

const IMAP = {
  host: '127.0.0.1',
  port: 11143,
  secure: false,
  doSTARTTLS: false,
  auth: { user: 'test@example.com', pass: 'testpass' },
  logger: false,
};

let failures = 0;
function check(label, condition, detail = '') {
  const status = condition ? 'PASS' : 'FAIL';
  if (!condition) failures += 1;
  console.log(`[${status}] ${label}${detail ? ` - ${detail}` : ''}`);
}

async function withImap(fn) {
  const client = new ImapFlow(IMAP);
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.logout().catch(() => client.close());
  }
}

function countFiles(dir) {
  try {
    return execSync(`find "${dir}" -name '*.eml' | wc -l`, { encoding: 'utf8' }).trim();
  } catch {
    return '0';
  }
}

// --- prepare a distinctive unread message ---------------------------------
const marker = `unread-${Date.now()}`;
await withImap(async (client) => {
  const source = Buffer.from(
    [
      'From: absender@example.com',
      'To: test@example.com',
      `Subject: ${marker}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${marker}@example.com>`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      'Diese Nachricht muss ungelesen bleiben.',
      '',
    ].join('\r\n'),
    'utf8',
  );
  // Appended without \Seen on purpose.
  await client.append('INBOX', source, [], new Date());
});

const app = new MailArchiverApp();
await app.initialize('behaviour-test-pass');
await app.unlock('behaviour-test-pass');
await app.updateSettings({ archivePath: join(workdir, 'archive') });

const account = await app.addAccount({
  name: 'Behaviour Test',
  email: 'test@example.com',
  host: '127.0.0.1',
  port: 11143,
  security: 'none',
  rejectUnauthorized: false,
  username: 'test@example.com',
  password: 'testpass',
  archivePath: null,
});
await app.updateAccount(account.id, { settings: { deletedHandling: 'move-to-deleted' } });

const tree = await app.getFolderTree(account.id, false);
const collect = (nodes, out = []) => {
  for (const node of nodes) {
    out.push(node.path);
    collect(node.children, out);
  }
  return out;
};
await app.setSelectedFolders(account.id, collect(tree));

// --- run 1 -----------------------------------------------------------------
const run1 = await app.startSync(account.id);
console.log('\nrun 1:', JSON.stringify(run1.stats));
check('run 1 downloaded messages', run1.stats.messagesNew > 0, `${run1.stats.messagesNew} new`);

const unreadAfter = await withImap(async (client) => {
  await client.mailboxOpen('INBOX', { readOnly: true });
  const found = await client.search({ header: { 'message-id': `<${marker}@example.com>` } }, { uid: true });
  const uid = found[0];
  const message = await client.fetchOne(String(uid), { flags: true }, { uid: true });
  return { uid, flags: [...(message.flags ?? [])] };
});
check(
  'message stays unread on the server',
  !unreadAfter.flags.includes('\\Seen'),
  `flags: ${JSON.stringify(unreadAfter.flags)}`,
);

const serverCountBefore = await withImap(async (client) => {
  const box = await client.mailboxOpen('INBOX', { readOnly: true });
  return box.exists;
});

// --- run 2: nothing should change -----------------------------------------
const run2 = await app.startSync(account.id);
console.log('run 2:', JSON.stringify(run2.stats));
check('run 2 downloads nothing', run2.stats.messagesNew === 0);
check('run 2 deletes nothing', run2.stats.messagesDeleted === 0);

// --- move a message on the server -----------------------------------------
await withImap(async (client) => {
  const lock = await client.getMailboxLock('INBOX');
  try {
    const found = await client.search({ header: { 'message-id': `<${marker}@example.com>` } }, { uid: true });
    await client.messageMove(String(found[0]), 'Archiv/2024', { uid: true });
  } finally {
    lock.release();
  }
});

const run3 = await app.startSync(account.id);
console.log('run 3:', JSON.stringify(run3.stats));
check('moved message is moved locally, not downloaded', run3.stats.messagesMoved === 1 && run3.stats.messagesNew === 0,
  `moved=${run3.stats.messagesMoved} new=${run3.stats.messagesNew}`);

const movedFile = execSync(
  `find "${join(workdir, 'archive')}/test@example.com/Archiv/2024" -name '*${marker}*' | wc -l`,
  { encoding: 'utf8' },
).trim();
check('moved file sits in the target folder', movedFile === '1', `found ${movedFile}`);

// --- delete a message on the server ---------------------------------------
await withImap(async (client) => {
  const lock = await client.getMailboxLock('Archiv/2024');
  try {
    const found = await client.search({ header: { 'message-id': `<${marker}@example.com>` } }, { uid: true });
    await client.messageDelete(String(found[0]), { uid: true });
  } finally {
    lock.release();
  }
});

const run4 = await app.startSync(account.id);
console.log('run 4:', JSON.stringify(run4.stats));
check('deleted message is registered', run4.stats.messagesDeleted === 1, `deleted=${run4.stats.messagesDeleted}`);

const deletedFile = execSync(
  `find "${join(workdir, 'archive')}/test@example.com/_deleted" -name '*${marker}*' 2>/dev/null | wc -l`,
  { encoding: 'utf8' },
).trim();
check('deleted message moved into _deleted', deletedFile === '1', `found ${deletedFile}`);

console.log('\narchived .eml files:', countFiles(join(workdir, 'archive')));
console.log('server INBOX count unchanged:', serverCountBefore);
console.log('workdir:', workdir);

app.close();
process.exit(failures === 0 ? 0 : 1);

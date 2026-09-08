/**
 * The message is deleted in the folder that holds the file, but stays in the
 * other one. The file has to move rather than disappear.
 */
import { join } from 'node:path';
import { readdirSync } from 'node:fs';
import { ImapFlow } from 'imapflow';

const workdir = process.argv[2];
process.env.MAIL_ARCHIVER_CONFIG_DIR = join(workdir, 'config');
process.env.MAIL_ARCHIVER_ARCHIVE_DIR = join(workdir, 'archive');

const { MailArchiverApp, logger } = await import('@mail-archiver/core');
logger.setLevel('info');
logger.on('entry', (entry) => {
  if (/still shown|Backup finished/.test(entry.message)) console.log('  ', entry.message);
});

const app = new MailArchiverApp();
await app.unlock('gmail-test');
const account = app.listAccounts()[0];
// Mirror: what the server drops, the archive drops - unless another folder
// still shows it.
await app.updateAccount(account.id, { settings: { deletedHandling: 'mirror' } });

const client = new ImapFlow({
  host: '127.0.0.1', port: 11143, secure: false,
  auth: { user: 'test@example.com', pass: 'testpass' }, logger: false,
});
await client.connect();
const lock = await client.getMailboxLock('INBOX');
try {
  await client.messageDelete({ uid: '1' }, { uid: true });
  console.log('deleted UID 1 in INBOX on the server');
} finally {
  lock.release();
}
await client.logout();

await app.startSync(account.id);

const before = app.search({ query: '', accountId: account.id, limit: 20 });
console.log('rows left:', before.total);
for (const folder of ['INBOX', 'Alle Nachrichten']) {
  const files = readdirSync(join(workdir, 'archive', 'gmail@example.com', folder)).filter((f) => f.endsWith('.eml'));
  console.log(`  ${folder}: ${files.length} file(s)`);
}

const inAllMail = before.hits.filter((h) => h.folderPath === 'Alle Nachrichten');
const message = await app.loadMessage(account.id, inAllMail[0].messageId);
console.log('the message whose file moved still reads:', message.text.trim());
const verify = await app.startVerify(account.id, {});
console.log('verification:', verify.stats.missing, 'missing,', verify.stats.changed, 'changed,', verify.stats.orphans, 'orphaned');
app.close();

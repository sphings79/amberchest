/** Archives the Gmail style mailbox once with and once without linking. */
import { rm } from 'node:fs/promises';
import { join } from 'node:path';

const workdir = process.argv[2];
const linkDuplicates = process.argv[3] === 'link';

await rm(workdir, { recursive: true, force: true });
process.env.MAIL_ARCHIVER_CONFIG_DIR = join(workdir, 'config');
process.env.MAIL_ARCHIVER_ARCHIVE_DIR = join(workdir, 'archive');

const { MailArchiverApp, logger } = await import('@mail-archiver/core');
logger.setLevel('warn');

const app = new MailArchiverApp();
await app.initialize('gmail-test');
await app.unlock('gmail-test');
await app.updateSettings({ archivePath: join(workdir, 'archive') });

const account = await app.addAccount({
  name: 'Gmail Test',
  email: 'gmail@example.com',
  host: '127.0.0.1',
  port: 11143,
  security: 'none',
  rejectUnauthorized: false,
  username: 'test@example.com',
  password: 'testpass',
  archivePath: null,
  settings: { linkDuplicates },
});

await app.setSelectedFolders(account.id, ['INBOX', 'Alle Nachrichten']);
const progress = await app.startSync(account.id);
const overview = app.overview()[0];

console.log(`linkDuplicates=${linkDuplicates}`);
console.log('  downloaded:', progress.stats.messagesNew, 'linked:', progress.stats.messagesLinked);
console.log('  index rows:', overview.messageCount, '| archive size:', overview.bytes, 'bytes');

const { readdirSync } = await import('node:fs');
for (const folder of ['INBOX', 'Alle Nachrichten']) {
  const files = readdirSync(join(workdir, 'archive', 'gmail@example.com', folder)).filter((f) =>
    f.endsWith('.eml'),
  );
  console.log(`  ${folder}: ${files.length} file(s) on disk`);
}
app.close();

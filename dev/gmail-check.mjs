/** Reads a linked message, indexes and verifies the archive. */
import { join } from 'node:path';
const workdir = process.argv[2];
process.env.MAIL_ARCHIVER_CONFIG_DIR = join(workdir, 'config');
process.env.MAIL_ARCHIVER_ARCHIVE_DIR = join(workdir, 'archive');

const { MailArchiverApp, logger } = await import('@mail-archiver/core');
logger.setLevel('warn');
const app = new MailArchiverApp();
await app.unlock('gmail-test');
const account = app.listAccounts()[0];

const rows = app.search({ query: '', accountId: account.id, limit: 20 });
const inAllMail = rows.hits.filter((hit) => hit.folderPath === 'Alle Nachrichten');
console.log('rows in "Alle Nachrichten":', inAllMail.length);

const message = await app.loadMessage(account.id, inAllMail[0].messageId);
console.log('reading a linked message:', JSON.stringify(message.subject), '->', message.text.trim());

const raw = await app.loadMessageSource(account.id, inAllMail[1].messageId);
console.log('its .eml is', raw.source.length, 'bytes, taken from', raw.filePath.split('/').slice(-2).join('/'));

await app.startIndexing(account.id);
const found = app.search({ query: 'nachricht', accountId: account.id });
console.log('full text search finds', found.total, 'of 6 rows');

const verify = await app.startVerify(account.id, {});
console.log('verification:', JSON.stringify(verify.stats));
app.close();

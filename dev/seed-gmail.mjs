/**
 * Builds what Gmail looks like over IMAP: every message sits in its folder and
 * in "All Mail" at the same time.
 */
import { ImapFlow } from 'imapflow';

const client = new ImapFlow({
  host: '127.0.0.1',
  port: 11143,
  secure: false,
  auth: { user: 'test@example.com', pass: 'testpass' },
  logger: false,
});

await client.connect();
for (const path of ['INBOX', 'Alle Nachrichten']) {
  try {
    await client.mailboxCreate(path);
  } catch {
    // Already there.
  }
}

for (let index = 1; index <= 3; index += 1) {
  const message =
    `Message-ID: <gmail-${index}@example.com>\r\n` +
    `From: absender${index}@example.com\r\n` +
    'To: test@example.com\r\n' +
    `Subject: Gmail Nachricht ${index}\r\n` +
    'Date: Mon, 15 Jan 2024 09:30:00 +0100\r\n' +
    '\r\n' +
    `Inhalt der Nachricht ${index}.\r\n`;

  // The very same message, in both folders - that is what Gmail does.
  await client.append('INBOX', message, ['\\Seen'], new Date('2024-01-15T09:30:00Z'));
  await client.append('Alle Nachrichten', message, ['\\Seen'], new Date('2024-01-15T09:30:00Z'));
}

await client.logout();
console.log('3 messages, each in INBOX and in "Alle Nachrichten"');

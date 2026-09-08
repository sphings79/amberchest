/**
 * Fills the local Dovecot container with a small but nasty test mailbox:
 * nested folders, umlauts and an ampersand in folder names (which exercises
 * modified UTF-7 encoding), special use folders, and a message with an
 * attachment.
 *
 * Usage:
 *   docker start mail-archiver-dovecot
 *   node dev/seed-testserver.mjs
 */
import { ImapFlow } from 'imapflow';

const HOST = process.env.TEST_IMAP_HOST ?? '127.0.0.1';
const PORT = Number(process.env.TEST_IMAP_PORT ?? 11143);
const USER = process.env.TEST_IMAP_USER ?? 'test@example.com';
const PASS = process.env.TEST_IMAP_PASS ?? 'testpass';

const FOLDERS = [
  'Projekte',
  'Projekte/Rechnungen',
  'Projekte/Angebote & Verträge',
  'Archiv/2024',
  'Müll',
];

function encodeSubject(subject) {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(subject)) return subject;
  return `=?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`;
}

function buildMessage({ subject, from, to, date, body, attachment }) {
  const messageId = `<${Math.random().toString(36).slice(2)}.${Date.now()}@example.com>`;
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeSubject(subject)}`,
    `Date: ${date.toUTCString()}`,
    `Message-ID: ${messageId}`,
    'MIME-Version: 1.0',
  ];

  if (!attachment) {
    headers.push('Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: 8bit');
    return Buffer.from(`${headers.join('\r\n')}\r\n\r\n${body}\r\n`, 'utf8');
  }

  const boundary = `----=_Part_${Math.random().toString(36).slice(2)}`;
  headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  const parts = [
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    body,
    `--${boundary}`,
    `Content-Type: ${attachment.type}; name="${attachment.name}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${attachment.name}"`,
    '',
    Buffer.from(attachment.content, 'utf8').toString('base64'),
    `--${boundary}--`,
    '',
  ];
  return Buffer.from(`${headers.join('\r\n')}\r\n\r\n${parts.join('\r\n')}`, 'utf8');
}

const MESSAGES = [
  { folder: 'INBOX', subject: 'Willkommen bei Mail Archiver', body: 'Erste Testnachricht.' },
  { folder: 'INBOX', subject: 'Grüße aus München', body: 'Umlaute im Betreff: äöüß.' },
  {
    folder: 'INBOX',
    subject: 'Rechnung mit Anhang',
    body: 'Die Rechnung liegt bei.',
    attachment: { name: 'rechnung.txt', type: 'text/plain', content: 'Betrag: 42,00 EUR' },
  },
  { folder: 'Projekte', subject: 'Projektstart', body: 'Los geht es.' },
  { folder: 'Projekte/Rechnungen', subject: 'Rechnung 2024-001', body: 'Bitte pruefen.' },
  {
    folder: 'Projekte/Rechnungen',
    subject: 'Rechnung 2024-002',
    body: 'Zweite Rechnung.',
    attachment: { name: 'rechnung.txt', type: 'text/plain', content: 'Betrag: 99,00 EUR' },
  },
  {
    folder: 'Projekte/Angebote & Verträge',
    subject: 'Angebot für Kunde Müller',
    body: 'Anbei.',
    attachment: { name: 'angebot.txt', type: 'text/plain', content: 'Angebot: 1.234,00 EUR' },
  },
  {
    folder: 'Projekte',
    subject: 'Weiterleitung des Angebots',
    body: 'Zur Info.',
    // Byte identical to the attachment above - exercises de-duplication.
    attachment: { name: 'angebot.txt', type: 'text/plain', content: 'Angebot: 1.234,00 EUR' },
  },
  { folder: 'Archiv/2024', subject: 'Altes Dokument', body: 'Aus dem Archiv.' },
  { folder: 'Sent', subject: 'Antwort auf Anfrage', body: 'Gesendete Nachricht.' },
  { folder: 'Drafts', subject: 'Entwurf', body: 'Noch nicht fertig.' },
  { folder: 'Trash', subject: 'Geloeschte Nachricht', body: 'Im Papierkorb.' },
  { folder: 'Müll', subject: 'Werbung', body: 'Unerwuenscht.' },
];

async function main() {
  const client = new ImapFlow({
    host: HOST,
    port: PORT,
    secure: false,
    doSTARTTLS: false,
    auth: { user: USER, pass: PASS },
    logger: false,
  });

  await client.connect();
  console.log('connected to', HOST, PORT);

  for (const folder of FOLDERS) {
    try {
      await client.mailboxCreate(folder);
      console.log('created', folder);
    } catch (error) {
      if (!String(error.message).includes('already exists')) console.log('skip', folder, error.message);
    }
  }

  let index = 0;
  for (const message of MESSAGES) {
    const date = new Date(Date.UTC(2024, 0, 15 + index, 9, 30, 0));
    const source = buildMessage({
      subject: message.subject,
      from: 'absender@example.com',
      to: USER,
      date,
      body: message.body,
      attachment: message.attachment,
    });
    await client.append(message.folder, source, ['\\Seen'], date);
    console.log('appended to', message.folder, '-', message.subject);
    index += 1;
  }

  await client.logout();
  console.log('done');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

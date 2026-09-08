import { describe, expect, it } from 'vitest';
import { extensionOf, extractAttachments } from '../src/attachments/extract.js';
import { sha256 } from '../src/util/hash.js';

interface PartSpec {
  contentType: string;
  disposition?: string;
  name?: string;
  cid?: string;
  content: string;
}

/** Builds a small multipart message for the parser to chew on. */
function buildMessage(parts: PartSpec[]): Buffer {
  const boundary = '----=_Test_Boundary';
  const head = [
    'From: sender@example.com',
    'To: receiver@example.com',
    'Subject: Test',
    'Date: Mon, 15 Jan 2024 14:30:22 +0000',
    'Message-ID: <test@example.com>',
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    '',
  ].join('\r\n');

  const body = parts
    .map((part) => {
      const headers = [`--${boundary}`, `Content-Type: ${part.contentType}${part.name ? `; name="${part.name}"` : ''}`];
      headers.push('Content-Transfer-Encoding: base64');
      if (part.disposition) {
        headers.push(
          `Content-Disposition: ${part.disposition}${part.name ? `; filename="${part.name}"` : ''}`,
        );
      }
      if (part.cid) headers.push(`Content-ID: <${part.cid}>`);
      headers.push('', Buffer.from(part.content, 'utf8').toString('base64'));
      return headers.join('\r\n');
    })
    .join('\r\n');

  return Buffer.from(`${head}${body}\r\n--${boundary}--\r\n`, 'utf8');
}

describe('extractAttachments', () => {
  it('reads name, type, size and hash of an attachment', async () => {
    const content = 'Betrag: 42,00 EUR';
    const message = buildMessage([
      { contentType: 'text/plain', content: 'Die Rechnung liegt bei.' },
      { contentType: 'application/pdf', disposition: 'attachment', name: 'rechnung.pdf', content },
    ]);

    const attachments = await extractAttachments(message);
    expect(attachments).toHaveLength(1);

    const attachment = attachments[0];
    expect(attachment?.originalName).toBe('rechnung.pdf');
    expect(attachment?.fileName).toBe('rechnung.pdf');
    expect(attachment?.contentType).toBe('application/pdf');
    expect(attachment?.size).toBe(Buffer.byteLength(content));
    expect(attachment?.sha256).toBe(sha256(Buffer.from(content, 'utf8')));
    expect(attachment?.inline).toBe(false);
  });

  it('marks embedded images as inline', async () => {
    const message = buildMessage([
      { contentType: 'text/html', content: '<p><img src="cid:logo"></p>' },
      {
        contentType: 'image/png',
        disposition: 'inline',
        name: 'logo.png',
        cid: 'logo',
        content: 'not-a-real-png',
      },
    ]);

    const attachments = await extractAttachments(message);
    expect(attachments).toHaveLength(1);
    expect(attachments[0]?.inline).toBe(true);
  });

  it('invents a name for parts that have none', async () => {
    const message = buildMessage([
      { contentType: 'text/plain', content: 'body' },
      { contentType: 'application/pdf', disposition: 'attachment', content: 'data' },
    ]);

    const attachments = await extractAttachments(message);
    expect(attachments[0]?.fileName).toMatch(/^attachment-\d+\.pdf$/);
  });

  it('makes dangerous names safe for the file system', async () => {
    const message = buildMessage([
      { contentType: 'text/plain', content: 'body' },
      {
        contentType: 'application/pdf',
        disposition: 'attachment',
        name: '../../etc/passwd.pdf',
        content: 'data',
      },
    ]);

    const attachments = await extractAttachments(message);
    const name = attachments[0]?.fileName ?? '';
    // No path separators, so the file cannot escape the target directory, and
    // no leading dot, so it does not become a hidden file.
    expect(name).not.toContain('/');
    expect(name).not.toContain('\\');
    expect(name.startsWith('.')).toBe(false);
    expect(name.endsWith('passwd.pdf')).toBe(true);
  });

  it('keeps umlauts in attachment names', async () => {
    const message = buildMessage([
      { contentType: 'text/plain', content: 'body' },
      {
        contentType: 'application/pdf',
        disposition: 'attachment',
        name: 'Übersicht Jänner.pdf',
        content: 'data',
      },
    ]);

    const attachments = await extractAttachments(message);
    expect(attachments[0]?.fileName).toBe('Übersicht Jänner.pdf');
  });

  it('gives identical content the same hash across messages', async () => {
    const first = await extractAttachments(
      buildMessage([
        { contentType: 'text/plain', content: 'body one' },
        { contentType: 'text/plain', disposition: 'attachment', name: 'a.txt', content: 'same' },
      ]),
    );
    const second = await extractAttachments(
      buildMessage([
        { contentType: 'text/plain', content: 'body two' },
        { contentType: 'text/plain', disposition: 'attachment', name: 'b.txt', content: 'same' },
      ]),
    );

    expect(first[0]?.sha256).toBe(second[0]?.sha256);
  });

  it('returns nothing for a message without attachments', async () => {
    const message = Buffer.from(
      [
        'From: a@b.c',
        'To: d@e.f',
        'Subject: plain',
        'Content-Type: text/plain; charset=utf-8',
        '',
        'Just text.',
        '',
      ].join('\r\n'),
      'utf8',
    );
    expect(await extractAttachments(message)).toHaveLength(0);
  });
});

describe('extensionOf', () => {
  it('returns the lower case extension', () => {
    expect(extensionOf('Rechnung.PDF')).toBe('pdf');
    expect(extensionOf('archive.tar.gz')).toBe('gz');
  });

  it('returns an empty string when there is none', () => {
    expect(extensionOf('README')).toBe('');
    expect(extensionOf('.hidden')).toBe('');
    expect(extensionOf('trailing.')).toBe('');
  });
});

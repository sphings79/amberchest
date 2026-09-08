import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { ArchiveDatabase } from '../src/db/database.js';
import { withFoldedVariants } from '../src/search/fold.js';
import { toMatchExpression } from '../src/search/query.js';
import { searchMessages } from '../src/search/search.js';
import { extractText, isExtractable } from '../src/search/text.js';
import type { RemoteFolder } from '../src/types.js';

describe('toMatchExpression', () => {
  it('quotes every word and searches by prefix', () => {
    expect(toMatchExpression('rechnung')).toBe('"rechnung"*');
    expect(toMatchExpression('rechnung januar')).toBe('"rechnung"* AND "januar"*');
  });

  it('keeps quoted input as a phrase', () => {
    expect(toMatchExpression('"Rechnung 2024-001"')).toBe('"Rechnung 2024-001"');
  });

  it('neutralises FTS operators that would otherwise be a syntax error', () => {
    // A user typing this must get a result, not an exception.
    expect(toMatchExpression('re: 50% -rabatt')).toBe('"re:"* AND "50%"* AND "-rabatt"*');
    expect(toMatchExpression('NEAR OR AND')).toBe('"NEAR"* AND "OR"* AND "AND"*');
    expect(toMatchExpression('a"b')).toBe('"ab"*');
  });

  it('returns null for empty input', () => {
    expect(toMatchExpression('')).toBeNull();
    expect(toMatchExpression('   ')).toBeNull();
    expect(toMatchExpression('""')).toBeNull();
  });
});

describe('isExtractable', () => {
  it('accepts documents, text and archives', () => {
    expect(isExtractable('application/pdf', 'a.pdf')).toBe(true);
    expect(isExtractable(null, 'report.docx')).toBe(true);
    expect(isExtractable(null, 'notes.txt')).toBe(true);
    expect(isExtractable(null, 'bundle.zip')).toBe(true);
    expect(isExtractable(null, 'backup.tar.gz')).toBe(true);
  });

  it('rejects what has no text in it', () => {
    expect(isExtractable('image/png', 'photo.png')).toBe(false);
    expect(isExtractable('application/octet-stream', 'firmware.bin')).toBe(false);
  });
});

describe('extractText', () => {
  it('reads plain text', async () => {
    const text = await extractText(Buffer.from('Vertragsnummer 4711', 'utf8'), 'text/plain', 'a.txt');
    expect(text).toBe('Vertragsnummer 4711');
  });

  it('strips markup from html', async () => {
    const html = '<html><body><p>Hallo <b>Welt</b></p><script>alert(1)</script></body></html>';
    const text = await extractText(Buffer.from(html, 'utf8'), 'text/html', 'a.html');
    expect(text).toContain('Hallo');
    expect(text).toContain('Welt');
    expect(text).not.toContain('<');
  });

  it('reads a tar.gz archive one level deep', async () => {
    // Minimal tar: one 512 byte header followed by the padded content.
    const content = Buffer.from('Protokoll der Sitzung', 'utf8');
    const header = Buffer.alloc(512);
    header.write('protokoll.txt', 0, 'utf8');
    header.write(content.length.toString(8).padStart(11, '0') + '\0', 124, 'ascii');
    header.write('0', 156, 'ascii');
    const body = Buffer.alloc(512);
    content.copy(body);
    const tar = Buffer.concat([header, body, Buffer.alloc(1024)]);

    const text = await extractText(gzipSync(tar), null, 'backup.tar.gz');
    expect(text).toContain('protokoll.txt');
    expect(text).toContain('Protokoll der Sitzung');
  });

  it('returns an empty string for content it cannot read', async () => {
    expect(await extractText(Buffer.from([0, 1, 2, 3]), 'image/png', 'a.png')).toBe('');
  });
});

describe('searchMessages', () => {
  function seed(): { db: ArchiveDatabase; accountId: string } {
    const db = new ArchiveDatabase(join(mkdtempSync(join(tmpdir(), 'ma-search-')), 'archive.db'));
    const accountId = 'acc-1';
    const folder: RemoteFolder = {
      path: 'INBOX',
      name: 'INBOX',
      delimiter: '/',
      specialUse: '\\Inbox',
      noSelect: false,
      messageCount: null,
      sizeBytes: null,
    };
    const row = db.upsertFolder(accountId, folder, 'INBOX');
    const other = db.upsertFolder(
      accountId,
      { ...folder, path: 'Projekte', name: 'Projekte', specialUse: null },
      'Projekte',
    );

    const insert = (uid: number, subject: string, from: string, date: string, folderId: number): number =>
      db.insertMessage({
        accountId,
        folderId,
        uid,
        uidvalidity: 1,
        messageId: `<${uid}@x>`,
        fingerprint: `fp-${uid}`,
        internalDate: date,
        size: 100 * uid,
        subject,
        fromAddr: from,
        toAddr: 'me@example.com',
        flags: ['\\Seen'],
        fileName: `${uid}.eml`,
      });

    const a = insert(1, 'Rechnung Januar', 'buchhaltung@example.com', '2024-01-15T10:00:00.000Z', row.id);
    const b = insert(2, 'Angebot Umbau', 'handwerk@example.com', '2024-03-02T10:00:00.000Z', other.id);
    const c = insert(3, 'Grüße aus München', 'freund@example.com', '2024-06-01T10:00:00.000Z', row.id);

    db.upsertMessageText({
      messageId: a,
      accountId,
      subject: 'Rechnung Januar',
      fromAddr: 'buchhaltung@example.com',
      toAddr: 'me@example.com',
      body: 'Anbei die Rechnung über 1.234 Euro.',
      attachmentText: 'rechnung.pdf Zahlbar bis Ende Februar',
    });
    db.upsertMessageText({
      messageId: b,
      accountId,
      subject: 'Angebot Umbau',
      fromAddr: 'handwerk@example.com',
      toAddr: 'me@example.com',
      body: 'Das Angebot für den Umbau der Küche.',
      attachmentText: '',
    });
    db.upsertMessageText({
      messageId: c,
      accountId,
      subject: withFoldedVariants('Grüße aus München'),
      fromAddr: 'freund@example.com',
      toAddr: 'me@example.com',
      body: withFoldedVariants('Viele Grüße aus dem Süden.'),
      attachmentText: '',
    });

    return { db, accountId };
  }

  it('finds words in the subject and the body', () => {
    const { db, accountId } = seed();
    expect(searchMessages(db, { query: 'rechnung', accountId }).total).toBe(1);
    expect(searchMessages(db, { query: 'küche', accountId }).total).toBe(1);
  });

  it('finds text that only exists inside an attachment', () => {
    const { db, accountId } = seed();
    const result = searchMessages(db, { query: 'zahlbar', accountId });
    expect(result.total).toBe(1);
    expect(result.hits[0]?.subject).toBe('Rechnung Januar');
  });

  it('ignores diacritics and understands German transliterations', () => {
    const { db, accountId } = seed();
    // Diacritics are handled by the tokeniser ...
    expect(searchMessages(db, { query: 'munchen', accountId }).total).toBe(1);
    expect(searchMessages(db, { query: 'München', accountId }).total).toBe(1);
    // ... ae/oe/ue/ss spellings by the folded variants in the index.
    expect(searchMessages(db, { query: 'muenchen', accountId }).total).toBe(1);
    expect(searchMessages(db, { query: 'gruesse', accountId }).total).toBe(1);
  });

  it('lists everything when there is no query', () => {
    const { db, accountId } = seed();
    const result = searchMessages(db, { query: '', accountId });
    expect(result.total).toBe(3);
    expect(result.textSearch).toBe(false);
    // Newest first when browsing.
    expect(result.hits[0]?.subject).toBe('Grüße aus München');
  });

  it('filters by folder, sender and date', () => {
    const { db, accountId } = seed();
    expect(searchMessages(db, { query: '', accountId, folders: ['Projekte'] }).total).toBe(1);
    expect(searchMessages(db, { query: '', accountId, from: 'handwerk' }).total).toBe(1);
    expect(searchMessages(db, { query: '', accountId, dateFrom: '2024-05-01' }).total).toBe(1);
    expect(searchMessages(db, { query: '', accountId, dateTo: '2024-01-31' }).total).toBe(1);
  });

  it('survives input that looks like FTS syntax', () => {
    const { db, accountId } = seed();
    expect(() => searchMessages(db, { query: 're: 50% -rabatt "', accountId })).not.toThrow();
  });

  it('restricts a text query to one field', () => {
    const { db, accountId } = seed();
    expect(searchMessages(db, { query: 'rechnung', accountId, field: 'subject' }).total).toBe(1);
    // "zahlbar" only exists in the attachment text, so the subject search misses it.
    expect(searchMessages(db, { query: 'zahlbar', accountId, field: 'attachments' }).total).toBe(1);
    expect(searchMessages(db, { query: 'zahlbar', accountId, field: 'subject' }).total).toBe(0);
    expect(searchMessages(db, { query: 'handwerk', accountId, field: 'from' }).total).toBe(1);
  });

  it('filters by recipient and size', () => {
    const { db, accountId } = seed();
    expect(searchMessages(db, { query: '', accountId, to: 'me@example.com' }).total).toBe(3);
    expect(searchMessages(db, { query: '', accountId, to: 'nobody' }).total).toBe(0);
    // Sizes are 100, 200 and 300 bytes.
    expect(searchMessages(db, { query: '', accountId, minSize: 250 }).total).toBe(1);
    expect(searchMessages(db, { query: '', accountId, maxSize: 150 }).total).toBe(1);
    expect(searchMessages(db, { query: '', accountId, minSize: 150, maxSize: 250 }).total).toBe(1);
  });

  it('sorts by date and size', () => {
    const { db, accountId } = seed();
    expect(searchMessages(db, { query: '', accountId, sort: 'date-asc' }).hits[0]?.subject).toBe(
      'Rechnung Januar',
    );
    expect(searchMessages(db, { query: '', accountId, sort: 'size-desc' }).hits[0]?.size).toBe(300);
    expect(searchMessages(db, { query: '', accountId, sort: 'size-asc' }).hits[0]?.size).toBe(100);
  });

  it('filters by read state and flag', () => {
    const { db, accountId } = seed();
    // Everything the seed inserts carries \\Seen and nothing else.
    expect(searchMessages(db, { query: '', accountId, unreadOnly: true }).total).toBe(0);
    expect(searchMessages(db, { query: '', accountId, flaggedOnly: true }).total).toBe(0);

    const folder = db.upsertFolder(
      accountId,
      {
        path: 'INBOX',
        name: 'INBOX',
        delimiter: '/',
        specialUse: '\\Inbox',
        noSelect: false,
        messageCount: null,
        sizeBytes: null,
      },
      'INBOX',
    );
    db.insertMessage({
      accountId,
      folderId: folder.id,
      uid: 9,
      uidvalidity: 1,
      messageId: '<9@x>',
      fingerprint: 'fp-9',
      internalDate: '2024-07-01T10:00:00.000Z',
      size: 900,
      subject: 'Ungelesen und markiert',
      fromAddr: 'neu@example.com',
      toAddr: 'me@example.com',
      flags: ['\\Flagged'],
      fileName: '9.eml',
    });

    expect(searchMessages(db, { query: '', accountId, unreadOnly: true }).total).toBe(1);
    expect(searchMessages(db, { query: '', accountId, flaggedOnly: true }).total).toBe(1);
  });

  it('returns a highlighted snippet', () => {
    const { db, accountId } = seed();
    const hit = searchMessages(db, { query: 'euro', accountId }).hits[0];
    expect(hit?.snippet).toContain('<mark>');
  });
});

describe('foldGerman', () => {
  it('transliterates umlauts and sharp s', () => {
    expect(withFoldedVariants('Grüße')).toBe('Grüße Gruesse');
    expect(withFoldedVariants('Straße in München')).toBe('Straße in München Strasse Muenchen');
  });

  it('leaves text without umlauts untouched', () => {
    expect(withFoldedVariants('Rechnung Januar')).toBe('Rechnung Januar');
  });
});

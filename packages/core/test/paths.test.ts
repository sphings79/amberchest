import { describe, expect, it } from 'vitest';
import {
  folderPathSegments,
  messageFileName,
  sanitizeSegment,
  uniqueFileName,
} from '../src/util/paths.js';

describe('sanitizeSegment', () => {
  it('keeps umlauts but normalises them to NFC', () => {
    // macOS hands out decomposed characters; both spellings must agree.
    const decomposed = 'Müll';
    expect(sanitizeSegment(decomposed)).toBe('Müll');
    expect(sanitizeSegment('Müll')).toBe(sanitizeSegment(decomposed));
  });

  it('replaces characters that are illegal in path segments', () => {
    expect(sanitizeSegment('Angebote/Verträge')).toBe('Angebote_Verträge');
    expect(sanitizeSegment('a:b*c?d"e<f>g|h')).toBe('a_b_c_d_e_f_g_h');
  });

  it('never produces an empty or dot-only segment', () => {
    expect(sanitizeSegment('')).toBe('_');
    expect(sanitizeSegment('...')).toBe('_');
    expect(sanitizeSegment('   ')).toBe('_');
  });

  it('avoids clashing with the reserved _deleted directory', () => {
    expect(sanitizeSegment('_deleted')).toBe('_deleted_');
  });

  it('escapes names reserved on Windows and SMB shares', () => {
    expect(sanitizeSegment('CON')).toBe('_CON');
    expect(sanitizeSegment('lpt1')).toBe('_lpt1');
  });

  it('shortens long names and keeps them unique', () => {
    const a = sanitizeSegment('x'.repeat(200));
    const b = sanitizeSegment(`${'x'.repeat(200)}y`);
    expect(Buffer.byteLength(a)).toBeLessThanOrEqual(100);
    expect(a).not.toBe(b);
  });
});

describe('folderPathSegments', () => {
  it('splits on the delimiter the server reported', () => {
    expect(folderPathSegments('INBOX.Projekte.Rechnungen', '.')).toEqual([
      'INBOX',
      'Projekte',
      'Rechnungen',
    ]);
    expect(folderPathSegments('Projekte/Angebote & Verträge', '/')).toEqual([
      'Projekte',
      'Angebote & Verträge',
    ]);
  });

  it('treats an empty delimiter as a flat namespace', () => {
    expect(folderPathSegments('A/B', '')).toEqual(['A_B']);
  });
});

describe('messageFileName', () => {
  const date = new Date('2024-01-15T14:30:22Z');

  it('builds a sortable name from date, uid and subject', () => {
    expect(messageFileName({ internalDate: date, uid: 42, subject: 'Rechnung Januar' })).toBe(
      '2024-01-15_143022_42_Rechnung-Januar.eml',
    );
  });

  it('falls back when the subject is empty', () => {
    expect(messageFileName({ internalDate: date, uid: 1, subject: null })).toBe(
      '2024-01-15_143022_1_no-subject.eml',
    );
  });

  it('survives an invalid internal date', () => {
    const name = messageFileName({ internalDate: new Date('nonsense'), uid: 7, subject: 'x' });
    expect(name).toMatch(/^1970-01-01_000000_7_x\.eml$/);
  });
});

describe('uniqueFileName', () => {
  it('appends a counter on collisions', () => {
    const taken = new Set(['a.eml', 'a_1.eml']);
    expect(uniqueFileName('a.eml', taken)).toBe('a_2.eml');
    expect(uniqueFileName('b.eml', taken)).toBe('b.eml');
  });
});

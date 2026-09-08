import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The German file is the source of truth; the English one is typed against it,
 * so TypeScript already catches missing keys. This test guards the part the
 * type system cannot see: placeholders that exist in one language only.
 */
function keysAndPlaceholders(source: string): Map<string, string[]> {
  const result = new Map<string, string[]>();
  const pattern = /^\s{2,}([\w-]+|'[^']+'):\s*(?:\n\s*)?'([^']*)'/gm;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(source)) !== null) {
    const key = (match[1] ?? '').replace(/'/g, '');
    const value = match[2] ?? '';
    const placeholders = [...value.matchAll(/\{\{(\w+)\}\}/g)].map((entry) => entry[1] as string);
    result.set(key, placeholders.sort());
  }
  return result;
}

describe('translations', () => {
  const base = join(import.meta.dirname, '../../web/src/i18n');
  const de = keysAndPlaceholders(readFileSync(join(base, 'de.ts'), 'utf8'));
  const en = keysAndPlaceholders(readFileSync(join(base, 'en.ts'), 'utf8'));

  it('uses the same placeholders in both languages', () => {
    const mismatched: string[] = [];
    for (const [key, placeholders] of de) {
      const english = en.get(key);
      if (!english) continue;
      if (placeholders.join(',') !== english.join(',')) {
        mismatched.push(`${key}: de(${placeholders.join(',')}) en(${english.join(',')})`);
      }
    }
    expect(mismatched).toEqual([]);
  });

  it('has a similar number of strings in both files', () => {
    // A rough guard against someone adding a block to one file only.
    expect(Math.abs(de.size - en.size)).toBeLessThanOrEqual(2);
  });
});

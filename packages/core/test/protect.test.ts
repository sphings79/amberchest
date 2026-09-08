import { describe, expect, it } from 'vitest';
import { isBeforeCutoff } from '../src/sync/protect.js';

describe('isBeforeCutoff', () => {
  it('protects everything older than the date', () => {
    expect(isBeforeCutoff('2019-05-04T09:00:00.000Z', '2024-01-01')).toBe(true);
    expect(isBeforeCutoff('2023-12-31T23:59:59.999Z', '2024-01-01')).toBe(true);
  });

  it('leaves the date itself and everything after it alone', () => {
    // "before 2024-01-01" ends with 2023; the first second of the date is new.
    expect(isBeforeCutoff('2024-01-01T00:00:00.000Z', '2024-01-01')).toBe(false);
    expect(isBeforeCutoff('2026-09-01T09:00:00.000Z', '2024-01-01')).toBe(false);
  });

  it('protects nothing while no date is set', () => {
    expect(isBeforeCutoff('1999-01-01T00:00:00.000Z', null)).toBe(false);
  });
});

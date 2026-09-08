import { describe, expect, it } from 'vitest';
import { CronParseError, isValidCron, matches, nextRun, parseCron } from '../src/schedule/cron.js';

/** Local time, because cron always works in the machine's time zone. */
function at(iso: string): Date {
  return new Date(iso);
}

describe('parseCron', () => {
  it('reads a plain expression', () => {
    const fields = parseCron('30 3 * * *');
    expect([...fields.minutes]).toEqual([30]);
    expect([...fields.hours]).toEqual([3]);
    expect(fields.daysOfMonth.size).toBe(31);
  });

  it('understands lists, ranges and steps', () => {
    expect([...parseCron('0,30 * * * *').minutes]).toEqual([0, 30]);
    expect([...parseCron('0 9-17 * * *').hours]).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect([...parseCron('*/15 * * * *').minutes]).toEqual([0, 15, 30, 45]);
    expect([...parseCron('0 0-12/6 * * *').hours]).toEqual([0, 6, 12]);
  });

  it('understands names and shorthands', () => {
    expect([...parseCron('0 0 * jan *').months]).toEqual([1]);
    expect([...parseCron('0 0 * * mon-fri').daysOfWeek]).toEqual([1, 2, 3, 4, 5]);
    expect([...parseCron('@daily').hours]).toEqual([0]);
    expect([...parseCron('@hourly').minutes]).toEqual([0]);
  });

  it('treats 0 and 7 as Sunday', () => {
    expect(parseCron('0 0 * * 7').daysOfWeek.has(0)).toBe(true);
  });

  it('rejects nonsense', () => {
    expect(() => parseCron('0 0 * *')).toThrow(CronParseError);
    expect(() => parseCron('99 0 * * *')).toThrow(CronParseError);
    expect(() => parseCron('0 0 * * xyz')).toThrow(CronParseError);
    expect(isValidCron('not a cron')).toBe(false);
    expect(isValidCron('0 3 * * *')).toBe(true);
  });
});

describe('matches', () => {
  it('fires at the configured minute only', () => {
    const fields = parseCron('30 3 * * *');
    expect(matches(fields, at('2024-01-15T03:30:00'))).toBe(true);
    expect(matches(fields, at('2024-01-15T03:31:00'))).toBe(false);
    expect(matches(fields, at('2024-01-15T04:30:00'))).toBe(false);
  });

  it('applies the classic either-or rule for the two day fields', () => {
    // The 1st of the month or any Monday.
    const fields = parseCron('0 0 1 * mon');
    expect(matches(fields, at('2024-01-01T00:00:00'))).toBe(true); // a Monday and the 1st
    expect(matches(fields, at('2024-01-08T00:00:00'))).toBe(true); // Monday
    expect(matches(fields, at('2024-02-01T00:00:00'))).toBe(true); // the 1st
    expect(matches(fields, at('2024-01-10T00:00:00'))).toBe(false); // neither
  });
});

describe('nextRun', () => {
  it('finds the next occurrence', () => {
    const fields = parseCron('0 3 * * *');
    const next = nextRun(fields, at('2024-01-15T10:00:00'));
    expect(next?.getDate()).toBe(16);
    expect(next?.getHours()).toBe(3);
    expect(next?.getMinutes()).toBe(0);
  });

  it('never returns the current minute', () => {
    const fields = parseCron('* * * * *');
    const from = at('2024-01-15T10:00:00');
    const next = nextRun(fields, from);
    expect(next?.getTime()).toBeGreaterThan(from.getTime());
  });

  it('handles February 29', () => {
    const fields = parseCron('0 0 29 2 *');
    const next = nextRun(fields, at('2024-03-01T00:00:00'));
    expect(next?.getFullYear()).toBe(2028);
    expect(next?.getMonth()).toBe(1);
    expect(next?.getDate()).toBe(29);
  });
});

/**
 * Cron expressions, the five field flavour.
 *
 * `minute hour day-of-month month day-of-week`, with `*`, lists (`1,15`),
 * ranges (`1-5`), steps (`*&#47;15`, `0-30/5`) and the usual shorthands. Written by
 * hand because a scheduler is the only thing the container needs on top of
 * what is already here, and cron is a small format.
 */

export interface CronFields {
  minutes: Set<number>;
  hours: Set<number>;
  daysOfMonth: Set<number>;
  months: Set<number>;
  daysOfWeek: Set<number>;
}

const SHORTHANDS: Record<string, string> = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
};

// Padded at the front: months are 1-12, so the index has to line up with the
// number, unlike the weekday names which start at 0 for Sunday.
const MONTH_NAMES = [
  '', 'jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
];
const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export class CronParseError extends Error {
  constructor(expression: string, reason: string) {
    super(`Invalid cron expression "${expression}": ${reason}`);
    this.name = 'CronParseError';
  }
}

function parseField(
  field: string,
  min: number,
  max: number,
  names: string[] = [],
  expression = '',
): Set<number> {
  const values = new Set<number>();

  for (const part of field.split(',')) {
    const [rangePart, stepPart] = part.split('/');
    const step = stepPart === undefined ? 1 : Number(stepPart);
    if (!Number.isInteger(step) || step < 1) throw new CronParseError(expression, `bad step in "${part}"`);

    let start = min;
    let end = max;

    if (rangePart !== undefined && rangePart !== '*') {
      const bounds = rangePart.split('-');
      const toNumber = (value: string): number => {
        const named = names.indexOf(value.toLowerCase());
        const parsed = named >= 0 ? named : Number(value);
        if (!Number.isInteger(parsed)) throw new CronParseError(expression, `bad value "${value}"`);
        return parsed;
      };
      start = toNumber(bounds[0] as string);
      end = bounds[1] === undefined ? start : toNumber(bounds[1]);
      // A bare number with a step means "from here to the end".
      if (bounds[1] === undefined && stepPart !== undefined) end = max;
    }

    if (start < min || end > max || start > end) {
      throw new CronParseError(expression, `"${part}" is outside ${min}-${max}`);
    }

    for (let value = start; value <= end; value += step) values.add(value);
  }

  return values;
}

export function parseCron(expression: string): CronFields {
  const trimmed = (SHORTHANDS[expression.trim().toLowerCase()] ?? expression).trim();
  const fields = trimmed.split(/\s+/);
  if (fields.length !== 5) {
    throw new CronParseError(expression, `expected 5 fields, got ${fields.length}`);
  }

  const daysOfWeek = parseField(fields[4] as string, 0, 7, DAY_NAMES, expression);
  // Both 0 and 7 mean Sunday.
  if (daysOfWeek.has(7)) daysOfWeek.add(0);

  return {
    minutes: parseField(fields[0] as string, 0, 59, [], expression),
    hours: parseField(fields[1] as string, 0, 23, [], expression),
    daysOfMonth: parseField(fields[2] as string, 1, 31, [], expression),
    months: parseField(fields[3] as string, 1, 12, MONTH_NAMES, expression),
    daysOfWeek,
  };
}

/** True when the expression fires at the given local time. */
export function matches(fields: CronFields, date: Date): boolean {
  if (!fields.minutes.has(date.getMinutes())) return false;
  if (!fields.hours.has(date.getHours())) return false;
  if (!fields.months.has(date.getMonth() + 1)) return false;

  // Classic cron rule: when both day fields are restricted, either one matching
  // is enough.
  const dayOfMonthRestricted = fields.daysOfMonth.size < 31;
  const dayOfWeekRestricted = fields.daysOfWeek.size < 8;
  const dayOfMonthHit = fields.daysOfMonth.has(date.getDate());
  const dayOfWeekHit = fields.daysOfWeek.has(date.getDay());

  if (dayOfMonthRestricted && dayOfWeekRestricted) return dayOfMonthHit || dayOfWeekHit;
  if (dayOfMonthRestricted) return dayOfMonthHit;
  if (dayOfWeekRestricted) return dayOfWeekHit;
  return true;
}

/** The next point in time the expression fires, searching minute by minute. */
export function nextRun(fields: CronFields, from = new Date()): Date | null {
  const candidate = new Date(from.getTime());
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  // Four years covers every February 29 combination.
  const limit = 366 * 4 * 24 * 60;
  for (let step = 0; step < limit; step += 1) {
    if (matches(fields, candidate)) return candidate;
    candidate.setMinutes(candidate.getMinutes() + 1);
  }
  return null;
}

/** Validates an expression without throwing. */
export function isValidCron(expression: string): boolean {
  try {
    parseCron(expression);
    return true;
  } catch {
    return false;
  }
}

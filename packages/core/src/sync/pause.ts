import type { ArchiveDatabase } from '../db/database.js';

const HOUR_MS = 60 * 60 * 1000;
/** Wait after the first pause; every further pause in a row doubles it. */
const FIRST_WAIT_MS = 6 * HOUR_MS;
const LONGEST_WAIT_MS = 48 * HOUR_MS;

/** How long a scheduled run keeps away after this many pauses in a row. */
export function pauseWaitMs(consecutive: number): number {
  if (consecutive <= 0) return 0;
  return Math.min(FIRST_WAIT_MS * 2 ** (consecutive - 1), LONGEST_WAIT_MS);
}

/**
 * When a scheduled run may try this account again, or null when it may now.
 *
 * A host that has just cut a connection off is not helped by another attempt
 * an hour later, and may take each one as a reason to stay closed longer. A
 * run started by hand is not held back by this; only the schedule is.
 */
export function pausedUntil(db: ArchiveDatabase, accountId: string): Date | null {
  const { consecutive, lastPausedAt } = db.pauseState(accountId);
  if (consecutive === 0 || !lastPausedAt) return null;
  const until = new Date(new Date(lastPausedAt).getTime() + pauseWaitMs(consecutive));
  return until.getTime() > Date.now() ? until : null;
}

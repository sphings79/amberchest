import type { ArchiveDatabase } from '../db/database.js';

/** A last backup older than this makes switching to passive worth a warning. */
export const STALE_AFTER_DAYS = 7;

/** Thrown instead of opening a connection for an account that is passive. */
export class AccountPassiveError extends Error {
  readonly code = 'ACCOUNT_PASSIVE';

  constructor(accountName: string) {
    super(`${accountName} is a passive archive and is never contacted. Switch it back to active first.`);
    this.name = 'AccountPassiveError';
  }
}

export type PassiveWarning =
  /** The account was never backed up. */
  | { reason: 'never' }
  /** The newest run did not finish cleanly (failed, paused, cancelled or still going). */
  | { reason: 'last-run-not-done'; status: string; error: string | null }
  /** The newest run finished, but long ago. */
  | { reason: 'stale'; finishedAt: string; days: number };

/**
 * Why a switch to passive deserves a second look, or null when the last
 * backup is clean and recent.
 *
 * A passive account is never contacted again, so a backup that is missing
 * something cannot be made up later - the server side may be gone by then.
 */
export function passiveWarning(
  db: ArchiveDatabase,
  accountId: string,
  now: Date = new Date(),
): PassiveWarning | null {
  const run = db.listRuns(accountId, 1)[0] as
    | { status?: string; finished_at?: string | null; error?: string | null }
    | undefined;
  if (!run) return { reason: 'never' };

  if (run.status !== 'done' || !run.finished_at) {
    return { reason: 'last-run-not-done', status: String(run.status ?? 'unknown'), error: run.error ?? null };
  }

  const days = Math.floor((now.getTime() - new Date(run.finished_at).getTime()) / (24 * 60 * 60 * 1000));
  if (days >= STALE_AFTER_DAYS) return { reason: 'stale', finishedAt: run.finished_at, days };
  return null;
}

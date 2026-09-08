/**
 * Whether a message is older than the date an account protects.
 *
 * Emptying a mailbox to win back space is a normal thing to do, and the
 * archive is exactly where that mail should survive it. The date itself counts
 * as new: "before 2024-01-01" means everything up to the end of 2023.
 */
export function isBeforeCutoff(internalDate: string, cutoff: string | null): boolean {
  if (!cutoff) return false;
  return internalDate < `${cutoff}T00:00:00.000Z`;
}

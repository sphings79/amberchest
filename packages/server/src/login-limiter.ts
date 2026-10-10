/**
 * Slows down guessing of the interface password.
 *
 * Per client address: five wrong tries lock that address out, for 15 minutes
 * the first time and twice as long every time it comes back and does it
 * again, up to a day. On top of that a ceiling for the whole server, so that
 * a guesser spread over many addresses is slowed down as well - at the price
 * that the real owner waits too while such an attack lasts.
 *
 * Kept in memory: a restart clears it, which is no worse than the sessions.
 */
export interface LimiterOptions {
  maxFailures?: number;
  baseLockMs?: number;
  maxLockMs?: number;
  /** Failures per minute across all addresses before everybody waits. */
  globalPerMinute?: number;
  /** How many addresses are remembered; the oldest go first. */
  maxEntries?: number;
  now?: () => number;
}

interface Entry {
  failures: number;
  strikes: number;
  lockedUntil: number;
  /** When this entry was last touched; strikes are forgotten after a day. */
  seen: number;
}

export type Verdict = { allowed: true } | { allowed: false; retryAfterSeconds: number };

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

export class LoginLimiter {
  private readonly entries = new Map<string, Entry>();
  private recent: number[] = [];
  private readonly maxFailures: number;
  private readonly baseLockMs: number;
  private readonly maxLockMs: number;
  private readonly globalPerMinute: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(options: LimiterOptions = {}) {
    this.maxFailures = options.maxFailures ?? 5;
    this.baseLockMs = options.baseLockMs ?? 15 * MINUTE_MS;
    this.maxLockMs = options.maxLockMs ?? DAY_MS;
    this.globalPerMinute = options.globalPerMinute ?? 50;
    this.maxEntries = options.maxEntries ?? 10_000;
    this.now = options.now ?? Date.now;
  }

  /** Whether this address may try at all right now. */
  check(key: string): Verdict {
    const now = this.now();

    const entry = this.entries.get(key);
    if (entry && entry.lockedUntil > now) {
      return { allowed: false, retryAfterSeconds: Math.ceil((entry.lockedUntil - now) / 1000) };
    }

    this.recent = this.recent.filter((at) => now - at < MINUTE_MS);
    if (this.recent.length >= this.globalPerMinute) {
      const oldest = this.recent[0] ?? now;
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((oldest + MINUTE_MS - now) / 1000)),
      };
    }

    return { allowed: true };
  }

  /** Counts a wrong try; returns true when it just locked the address. */
  recordFailure(key: string): boolean {
    const now = this.now();
    this.recent.push(now);

    let entry = this.entries.get(key);
    if (!entry || now - entry.seen > DAY_MS) {
      entry = { failures: 0, strikes: 0, lockedUntil: 0, seen: now };
    }
    entry.seen = now;
    entry.failures += 1;

    let locked = false;
    if (entry.failures >= this.maxFailures) {
      const lock = Math.min(this.baseLockMs * 2 ** entry.strikes, this.maxLockMs);
      entry.lockedUntil = now + lock;
      entry.strikes += 1;
      entry.failures = 0;
      locked = true;
    }

    // Re-inserted, so the map stays ordered by last use.
    this.entries.delete(key);
    this.entries.set(key, entry);
    this.trim();
    return locked;
  }

  /** A correct password clears the count, though not the strikes. */
  recordSuccess(key: string): void {
    const entry = this.entries.get(key);
    if (entry) entry.failures = 0;
  }

  private trim(): void {
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) return;
      this.entries.delete(oldest);
    }
  }
}

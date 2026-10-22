import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

/** Rotate at this size; with three files that is at most 150 MB on disk. */
export const LOG_FILE_MAX_BYTES = 50 * 1024 * 1024;
export const LOG_FILE_KEEP = 3;

/**
 * A log file that cannot grow without limit.
 *
 * When the current file would pass the limit it becomes `.1`, an older `.1`
 * becomes `.2`, and so on; the oldest is deleted. Writing is synchronous on
 * purpose: log lines are few compared with what the program does between
 * them, and a line that is still queued when the process dies is the one that
 * explains why it died.
 *
 * A file that cannot be written is not allowed to take the program down with
 * it; the first failure is reported once and the rest are dropped.
 */
export class RotatingLogFile {
  private size = 0;
  private failed = false;

  constructor(
    readonly path: string,
    private readonly maxBytes = LOG_FILE_MAX_BYTES,
    private readonly keep = LOG_FILE_KEEP,
    private readonly onError: (error: Error) => void = () => undefined,
  ) {
    try {
      mkdirSync(dirname(path), { recursive: true });
      this.size = statSync(path).size;
    } catch {
      this.size = 0;
    }
  }

  write(line: string): void {
    if (this.failed) return;
    const text = `${line}\n`;
    const bytes = Buffer.byteLength(text);
    try {
      if (this.size > 0 && this.size + bytes > this.maxBytes) this.rotate();
      appendFileSync(this.path, text, { mode: 0o600 });
      this.size += bytes;
    } catch (error) {
      this.failed = true;
      this.onError(error as Error);
    }
  }

  /** Every file that exists, the current one first. */
  files(): string[] {
    const names = [this.path];
    for (let index = 1; index < this.keep; index += 1) names.push(`${this.path}.${index}`);
    return names;
  }

  private rotate(): void {
    rmSync(`${this.path}.${this.keep - 1}`, { force: true });
    for (let index = this.keep - 2; index >= 1; index -= 1) {
      try {
        renameSync(`${this.path}.${index}`, `${this.path}.${index + 1}`);
      } catch {
        // A generation that does not exist yet.
      }
    }
    renameSync(this.path, `${this.path}.1`);
    this.size = 0;
  }
}

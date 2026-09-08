import { statfs } from 'node:fs/promises';
import { logger } from '../util/logger.js';

export interface DiskSpace {
  /** Bytes an unprivileged process may still write. */
  free: number;
  total: number;
  /** Where the numbers were measured; the archive directory or its parent. */
  path: string;
}

export class DiskFullError extends Error {
  constructor(
    readonly free: number,
    readonly limit: number,
  ) {
    super(`Only ${Math.round(free / 1024 / 1024)} MB left on the archive volume`);
    this.name = 'DiskFullError';
  }
}

/**
 * How much room the archive still has.
 *
 * Reported for the volume the directory sits on, using the space available to
 * an ordinary process - on many file systems that is noticeably less than the
 * free space, because a slice is reserved for root.
 */
export async function diskSpace(path: string): Promise<DiskSpace | null> {
  try {
    const stats = await statfs(path);
    return {
      free: Number(stats.bavail) * Number(stats.bsize),
      total: Number(stats.blocks) * Number(stats.bsize),
      path,
    };
  } catch (error) {
    // A directory that does not exist yet, or a file system that cannot say.
    logger.debug(`Cannot read the free space of ${path}: ${(error as Error).message}`);
    return null;
  }
}

/** Throws once the volume is fuller than the configured limit allows. */
export async function assertRoom(path: string, stopBelowBytes: number): Promise<void> {
  if (stopBelowBytes <= 0) return;
  const space = await diskSpace(path);
  if (space && space.free < stopBelowBytes) throw new DiskFullError(space.free, stopBelowBytes);
}

export function gigabytes(value: number): number {
  return Math.round(value / 1024 / 1024 / 1024);
}

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DiskFullError, assertRoom, diskSpace } from '../src/storage/disk.js';

describe('diskSpace', () => {
  it('reads the free space of a real directory', async () => {
    const space = await diskSpace(mkdtempSync(join(tmpdir(), 'ma-disk-')));
    expect(space).not.toBeNull();
    expect(space!.free).toBeGreaterThan(0);
    expect(space!.total).toBeGreaterThanOrEqual(space!.free);
  });

  it('returns nothing for a directory that is not there', async () => {
    expect(await diskSpace('/definitely/not/here')).toBeNull();
  });
});

describe('assertRoom', () => {
  it('lets a run through while there is room', async () => {
    const path = mkdtempSync(join(tmpdir(), 'ma-disk-'));
    await expect(assertRoom(path, 1024)).resolves.toBeUndefined();
  });

  it('stops a run when the limit is above everything there is', async () => {
    const path = mkdtempSync(join(tmpdir(), 'ma-disk-'));
    // A petabyte: no test machine has that free.
    await expect(assertRoom(path, 1024 ** 5)).rejects.toBeInstanceOf(DiskFullError);
  });

  it('does nothing when the guard is switched off', async () => {
    await expect(assertRoom('/definitely/not/here', 0)).resolves.toBeUndefined();
  });
});

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { appSettingsSchema } from '../src/config/schema.js';
import { Logger } from '../src/util/logger.js';
import { RotatingLogFile } from '../src/util/log-file.js';

const dir = () => mkdtempSync(join(tmpdir(), 'ac-log-'));

describe('RotatingLogFile', () => {
  it('appends lines', () => {
    const path = join(dir(), 'logs', 'a.log');
    const file = new RotatingLogFile(path);
    file.write('one');
    file.write('two');
    expect(readFileSync(path, 'utf8')).toBe('one\ntwo\n');
  });

  it('rotates at the limit and keeps a fixed number of files', () => {
    const path = join(dir(), 'a.log');
    const file = new RotatingLogFile(path, 20, 3);
    for (const line of ['aaaaaaaaaaaa', 'bbbbbbbbbbbb', 'cccccccccccc', 'dddddddddddd']) file.write(line);

    expect(readFileSync(path, 'utf8')).toBe('dddddddddddd\n');
    expect(readFileSync(`${path}.1`, 'utf8')).toBe('cccccccccccc\n');
    expect(readFileSync(`${path}.2`, 'utf8')).toBe('bbbbbbbbbbbb\n');
    // Three files in all: the oldest generation is gone.
    expect(existsSync(`${path}.3`)).toBe(false);
  });

  it('carries on after a restart with the size the file already has', () => {
    const path = join(dir(), 'a.log');
    new RotatingLogFile(path, 20, 3).write('aaaaaaaaaaaa');
    const again = new RotatingLogFile(path, 20, 3);
    again.write('bbbbbbbbbbbb');
    expect(readFileSync(`${path}.1`, 'utf8')).toBe('aaaaaaaaaaaa\n');
  });

  it('reports a file that cannot be written once and does not throw', () => {
    const errors: string[] = [];
    // A file where the directory should be.
    const blocker = join(dir(), 'blocker');
    writeFileSync(blocker, '');
    const path = join(blocker, 'a.log');
    const file = new RotatingLogFile(path, 20, 3, (error) => errors.push(error.message));
    expect(() => {
      file.write('x');
      file.write('y');
    }).not.toThrow();
    expect(errors).toHaveLength(1);
  });
});

describe('Logger file output', () => {
  it('writes entries at or above its level, with the detail below', () => {
    const path = join(dir(), 'a.log');
    const logger = new Logger();
    logger.setLevel('info');
    logger.setFile(path);
    logger.debug('hidden');
    logger.error('visible', { detail: 'stack line' });

    const text = readFileSync(path, 'utf8');
    expect(text).not.toContain('hidden');
    expect(text).toMatch(/\[error\] visible\nstack line\n$/);
  });

  it('stops writing when the file is switched off', () => {
    const path = join(dir(), 'a.log');
    const logger = new Logger();
    logger.setFile(path);
    logger.info('first');
    logger.setFile(null);
    logger.info('second');
    expect(readFileSync(path, 'utf8')).not.toContain('second');
  });
});

describe('logging settings', () => {
  it('leave the level alone and the file off until chosen', () => {
    expect(appSettingsSchema.parse({}).logging).toEqual({ level: null, toFile: false });
  });
});

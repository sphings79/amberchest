import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyLegacyEnv, configDir, migrateLegacyConfigDir } from '../src/config/locations.js';

/**
 * The rename from Mail Archiver to AmberChest moved both the configuration
 * directory and the environment prefix. Getting this wrong looks exactly like
 * a lost installation, so it is worth a test.
 */
describe('migrateLegacyConfigDir', () => {
  // Restored key by key on purpose: assigning to process.env as a whole
  // replaces a JavaScript object while the real environment stays as it was,
  // and os.homedir() reads the real one.
  const KEYS = ['HOME', 'APPDATA', 'XDG_CONFIG_HOME', 'AMBERCHEST_CONFIG_DIR', 'MAIL_ARCHIVER_CONFIG_DIR'];
  const saved = new Map(KEYS.map((key) => [key, process.env[key]]));
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'ac-home-'));
    process.env.HOME = home;
    process.env.APPDATA = join(home, 'AppData', 'Roaming');
    process.env.XDG_CONFIG_HOME = join(home, '.config');
    delete process.env.AMBERCHEST_CONFIG_DIR;
    delete process.env.MAIL_ARCHIVER_CONFIG_DIR;
  });

  afterEach(() => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  /** The directory the old name used, for whichever platform the test runs on. */
  function legacyDir(): string {
    if (process.platform === 'darwin') return join(home, 'Library', 'Application Support', 'MailArchiver');
    if (process.platform === 'win32') return join(process.env.APPDATA!, 'MailArchiver');
    return join(process.env.XDG_CONFIG_HOME!, 'mail-archiver');
  }

  it('moves an installation from before the rename', () => {
    mkdirSync(legacyDir(), { recursive: true });
    writeFileSync(join(legacyDir(), 'config.enc'), 'encrypted');

    expect(migrateLegacyConfigDir()).toBe(true);
    expect(existsSync(join(configDir(), 'config.enc'))).toBe(true);
    expect(existsSync(legacyDir())).toBe(false);
  });

  it('runs once and then leaves things alone', () => {
    mkdirSync(legacyDir(), { recursive: true });
    expect(migrateLegacyConfigDir()).toBe(true);
    expect(migrateLegacyConfigDir()).toBe(false);
  });

  it('never overwrites a directory that is already there', () => {
    mkdirSync(legacyDir(), { recursive: true });
    writeFileSync(join(legacyDir(), 'config.enc'), 'old');
    mkdirSync(configDir(), { recursive: true });
    writeFileSync(join(configDir(), 'config.enc'), 'current');

    expect(migrateLegacyConfigDir()).toBe(false);
    expect(existsSync(legacyDir())).toBe(true);
  });

  it('keeps out of the way when the path was set by hand', () => {
    mkdirSync(legacyDir(), { recursive: true });
    process.env.AMBERCHEST_CONFIG_DIR = join(home, 'chosen');
    expect(migrateLegacyConfigDir()).toBe(false);
  });

  it('does nothing when there is no old installation', () => {
    expect(migrateLegacyConfigDir()).toBe(false);
  });
});

describe('applyLegacyEnv', () => {
  it('carries the old variables over', () => {
    const env = { MAIL_ARCHIVER_MASTER_PASSWORD: 'secret', MAIL_ARCHIVER_PORT: '8484' };
    expect(applyLegacyEnv(env).sort()).toEqual([
      'MAIL_ARCHIVER_MASTER_PASSWORD',
      'MAIL_ARCHIVER_PORT',
    ]);
    expect(env).toMatchObject({ AMBERCHEST_MASTER_PASSWORD: 'secret', AMBERCHEST_PORT: '8484' });
  });

  it('lets the current name win over the old one', () => {
    const env = { MAIL_ARCHIVER_CRON: 'old', AMBERCHEST_CRON: 'current' };
    expect(applyLegacyEnv(env)).toEqual([]);
    expect(env.AMBERCHEST_CRON).toBe('current');
  });

  it('leaves everything else alone', () => {
    const env = { PATH: '/usr/bin', TZ: 'Europe/Berlin' };
    expect(applyLegacyEnv(env)).toEqual([]);
    expect(Object.keys(env).sort()).toEqual(['PATH', 'TZ']);
  });
});

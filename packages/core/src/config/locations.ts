import { existsSync, renameSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { logger } from '../util/logger.js';

/**
 * The environment prefix this application used when it was called Mail
 * Archiver. Assembled from parts on purpose: a search-and-replace over the
 * old name must not rewrite the very code that recognises it.
 */
const LEGACY_PREFIX = `MAIL_${'ARCHIVER'}_`;

/**
 * Where configuration and archive live.
 *
 * Everything can be overridden with environment variables, which is how the
 * container mounts its volumes.
 */
export function configDir(): string {
  const override = process.env.AMBERCHEST_CONFIG_DIR;
  if (override) return override;
  if (platform() === 'darwin') return join(homedir(), 'Library', 'Application Support', 'AmberChest');
  if (platform() === 'win32') {
    return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'AmberChest');
  }
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'amberchest');
}

export function defaultArchiveDir(): string {
  const override = process.env.AMBERCHEST_ARCHIVE_DIR;
  if (override) return override;
  if (platform() === 'darwin') return join(homedir(), 'AmberChest Archive');
  return join(homedir(), 'amberchest-archive');
}

export function configFilePath(): string {
  return join(configDir(), 'config.enc');
}

export function databaseFilePath(): string {
  return join(configDir(), 'archive.db');
}

/** Where the configuration lived while the application was called Mail Archiver. */
function legacyConfigDir(): string {
  if (platform() === 'darwin') return join(homedir(), 'Library', 'Application Support', 'MailArchiver');
  if (platform() === 'win32') {
    return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'MailArchiver');
  }
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'mail-archiver');
}

/**
 * Carries an installation from before the rename over to the new directory.
 *
 * The configuration is encrypted and the index database sits beside it, so
 * leaving them behind would look exactly like a lost installation. The
 * directory is moved, not copied: two copies of an archive index that both
 * think they own the same files would be worse than either.
 *
 * Only ever runs when the new directory does not exist yet, so it cannot
 * overwrite anything, and never when a path was set by hand.
 */
export function migrateLegacyConfigDir(): boolean {
  if (process.env.AMBERCHEST_CONFIG_DIR || process.env.MAIL_ARCHIVER_CONFIG_DIR) return false;

  const target = configDir();
  const legacy = legacyConfigDir();
  if (target === legacy) return false;
  if (existsSync(target) || !existsSync(legacy)) return false;

  try {
    renameSync(legacy, target);
    logger.info(`Moved the configuration from ${legacy} to ${target} after the rename to AmberChest`);
    return true;
  } catch (error) {
    logger.warn(
      `Could not move ${legacy} to ${target}: ${(error as Error).message}. ` +
        'Move the directory by hand, or the application starts as if it were new.',
    );
    return false;
  }
}

/**
 * Lets the environment variables of the old name keep working.
 *
 * A container that was configured as Mail Archiver would otherwise come up
 * without a master password and without its volumes, which looks like data
 * loss. The old names are copied over once at start, and complained about.
 */
export function applyLegacyEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const carried: string[] = [];
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith(LEGACY_PREFIX) || value === undefined) continue;
    const renamed = `AMBERCHEST_${key.slice(LEGACY_PREFIX.length)}`;
    if (env[renamed] === undefined) {
      env[renamed] = value;
      carried.push(key);
    }
  }
  if (carried.length > 0) {
    logger.warn(
      `Using ${carried.join(', ')} from before the rename. ` +
        'Rename them to AMBERCHEST_* — the old names will stop working in a future version.',
    );
  }
  return carried;
}

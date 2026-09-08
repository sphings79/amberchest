import { homedir, platform } from 'node:os';
import { join } from 'node:path';

/**
 * Where configuration and archive live.
 *
 * Everything can be overridden with environment variables, which is how the
 * container mounts its volumes.
 */
export function configDir(): string {
  const override = process.env.MAIL_ARCHIVER_CONFIG_DIR;
  if (override) return override;
  if (platform() === 'darwin') return join(homedir(), 'Library', 'Application Support', 'MailArchiver');
  if (platform() === 'win32') {
    return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'MailArchiver');
  }
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'mail-archiver');
}

export function defaultArchiveDir(): string {
  const override = process.env.MAIL_ARCHIVER_ARCHIVE_DIR;
  if (override) return override;
  if (platform() === 'darwin') return join(homedir(), 'Mail Archive');
  return join(homedir(), 'mail-archive');
}

export function configFilePath(): string {
  return join(configDir(), 'config.enc');
}

export function databaseFilePath(): string {
  return join(configDir(), 'archive.db');
}

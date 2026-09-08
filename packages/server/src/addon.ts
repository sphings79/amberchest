import { readFileSync } from 'node:fs';

/**
 * Support for running as a Home Assistant add-on.
 *
 * The supervisor writes the user's choices to /data/options.json and gives the
 * add-on no environment of its own, so the options are read here and turned
 * into the same environment variables the container already understands. That
 * keeps one code path for both ways of running.
 */
export const OPTIONS_PATH = '/data/options.json';

/** The address the supervisor's ingress gateway talks from. */
export const INGRESS_ADDRESS = '172.30.32.2';

interface AddonOptions {
  master_password?: string;
  ui_password?: string;
  cron?: string;
  cron_export_attachments?: boolean;
  archive_path?: string;
  config_path?: string;
  log_level?: string;
}

/**
 * Reads /data/options.json and fills the environment from it.
 *
 * Anything already set in the environment wins, so a compose file that sets
 * variables by hand keeps working.
 */
export function applyAddonOptions(
  path = OPTIONS_PATH,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  let options: AddonOptions;
  try {
    options = JSON.parse(readFileSync(path, 'utf8')) as AddonOptions;
  } catch {
    return false;
  }

  const set = (key: string, value: string | undefined): void => {
    if (value && !env[key]) env[key] = value;
  };

  set('MAIL_ARCHIVER_MASTER_PASSWORD', options.master_password);
  set('MAIL_ARCHIVER_UI_PASSWORD', options.ui_password);
  set('MAIL_ARCHIVER_CRON', options.cron);
  set('MAIL_ARCHIVER_CRON_EXPORT_ATTACHMENTS', options.cron_export_attachments ? 'true' : undefined);
  // The paths are the exception to "the environment wins": the image points
  // them at /config and /archive, and neither of those survives an add-on
  // update. What the supervisor persists is /data and the shared folders.
  env.MAIL_ARCHIVER_CONFIG_DIR = options.config_path || '/data/config';
  env.MAIL_ARCHIVER_ARCHIVE_DIR = options.archive_path || '/share/mail-archive';
  set('MAIL_ARCHIVER_LOG_LEVEL', options.log_level);

  // Without a password of its own the interface is reachable through ingress
  // only, and Home Assistant has already authenticated whoever gets there.
  if (!env.MAIL_ARCHIVER_UI_PASSWORD) env.MAIL_ARCHIVER_INGRESS_ONLY = 'true';

  return true;
}

/** Addresses that may talk to an add-on without a login in front of it. */
const ALLOWED = new Set([
  INGRESS_ADDRESS,
  // Node reports IPv4 clients on a dual stack socket in this notation.
  `::ffff:${INGRESS_ADDRESS}`,
  // The container's own healthcheck.
  '127.0.0.1',
  '::ffff:127.0.0.1',
  '::1',
]);

/**
 * Whether a request came through the ingress gateway, or from inside.
 *
 * Home Assistant requires an add-on to answer the supervisor and nobody else,
 * because there is no login in front of it. The loopback address is allowed as
 * well: only a process inside the container can use it, and the healthcheck
 * does.
 */
export function isIngressAddress(address: string | undefined): boolean {
  return address !== undefined && ALLOWED.has(address);
}

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { MailArchiverApp, Scheduler, isValidCron, logger } from '@mail-archiver/core';
import { AuthGuard } from './auth.js';
import { startServer } from './index.js';

/**
 * Headless entry point: the container, and frontend development.
 *
 * Everything is configured through environment variables, because that is how
 * a container is configured. The master password unlocks the encrypted
 * configuration without anyone at the keyboard.
 */
async function main(): Promise<void> {
  // In a container the log belongs on stdout, that is what `docker logs` reads.
  logger.setLevel((process.env.MAIL_ARCHIVER_LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error') ?? 'info');
  logger.on('entry', (entry) => {
    const line = `${entry.ts} [${entry.level}] ${entry.message}`;
    if (entry.level === 'error' || entry.level === 'warn') process.stderr.write(`${line}\n`);
    else process.stdout.write(`${line}\n`);
  });

  const app = new MailArchiverApp();
  const auth = AuthGuard.fromEnvironment();

  const masterPassword = process.env.MAIL_ARCHIVER_MASTER_PASSWORD;
  if (masterPassword) {
    if (!app.isInitialized) {
      await app.initialize(masterPassword);
      logger.info('Created a new configuration from MAIL_ARCHIVER_MASTER_PASSWORD');
    }
    await app.unlock(masterPassword);
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const webRoot = process.env.MAIL_ARCHIVER_WEB_ROOT ?? resolve(here, '../../web/dist');

  const running = await startServer({
    app,
    auth,
    webRoot,
    host: process.env.MAIL_ARCHIVER_HOST ?? '0.0.0.0',
    port: Number(process.env.MAIL_ARCHIVER_PORT ?? 8484),
  });

  logger.info(`Mail Archiver listening on ${running.url} (auth: ${auth.mode})`);

  if (auth.mode === 'none') {
    logger.warn(
      'No MAIL_ARCHIVER_UI_PASSWORD is set: anyone who can reach this port can use the interface.',
    );
  }

  // ---------------------------------------------------------------- schedule
  let scheduler: Scheduler | null = null;
  const expression = process.env.MAIL_ARCHIVER_CRON;

  if (expression) {
    if (!masterPassword) {
      logger.error('MAIL_ARCHIVER_CRON needs MAIL_ARCHIVER_MASTER_PASSWORD, otherwise nothing can run unattended.');
    } else if (!isValidCron(expression)) {
      logger.error(`MAIL_ARCHIVER_CRON is not a valid cron expression: ${expression}`);
    } else {
      scheduler = new Scheduler({
        app,
        expression,
        exportAttachments: process.env.MAIL_ARCHIVER_CRON_EXPORT_ATTACHMENTS === 'true',
      });
      scheduler.start();
      // The MQTT sensor for the next run needs to know about the schedule.
      app.setScheduleProvider(() => scheduler?.nextRun ?? null);
    }
  }

  const shutdown = async (): Promise<void> => {
    scheduler?.stop();
    await running.close();
    app.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});

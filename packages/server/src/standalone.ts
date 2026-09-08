import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { MailArchiverApp, logger } from '@mail-archiver/core';
import { AuthGuard } from './auth.js';
import { startServer } from './index.js';

/**
 * Headless entry point.
 *
 * Used for frontend development and, from stage 5 on, by the container. The
 * master password comes from the environment so an unattended start can unlock
 * the configuration without a human at the keyboard.
 */
async function main(): Promise<void> {
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
  // eslint-disable-next-line no-console
  console.log(`Mail Archiver listening on ${running.url} (auth: ${auth.mode})`);

  const shutdown = async (): Promise<void> => {
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

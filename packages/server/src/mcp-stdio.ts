import { createInterface } from 'node:readline';
import { MailArchiverApp, handleRawMessage, logger } from '@mail-archiver/core';

/**
 * MCP over stdio, the transport Claude Desktop and most editors speak.
 *
 * Configure it there roughly like this:
 *
 *   {
 *     "mcpServers": {
 *       "mail-archiver": {
 *         "command": "node",
 *         "args": ["/path/to/mail-archiver/packages/server/dist/mcp-stdio.js"],
 *         "env": { "MAIL_ARCHIVER_MASTER_PASSWORD": "..." }
 *       }
 *     }
 *   }
 *
 * Nothing is written to stdout except protocol messages - logs go to stderr,
 * because stdout is the transport.
 */
async function main(): Promise<void> {
  const masterPassword = process.env.MAIL_ARCHIVER_MASTER_PASSWORD;
  if (!masterPassword) {
    process.stderr.write(
      'MAIL_ARCHIVER_MASTER_PASSWORD is required so the configuration can be unlocked.\n',
    );
    process.exit(1);
  }

  const app = new MailArchiverApp();
  if (!app.isInitialized) {
    process.stderr.write('No configuration found. Set up Mail Archiver first.\n');
    process.exit(1);
  }

  await app.unlock(masterPassword);

  if (!app.getSettings().mcp.enabled) {
    process.stderr.write('MCP is switched off in the Mail Archiver settings.\n');
    process.exit(1);
  }

  logger.on('entry', (entry) => {
    if (entry.level === 'error' || entry.level === 'warn') {
      process.stderr.write(`[${entry.level}] ${entry.message}\n`);
    }
  });

  const server = app.createMcpServer();
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });

  process.stderr.write('Mail Archiver MCP server ready on stdio\n');

  for await (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const response = await handleRawMessage(server, trimmed);
    if (response) process.stdout.write(`${response}\n`);
  }

  app.close();
}

main().catch((error: unknown) => {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exit(1);
});

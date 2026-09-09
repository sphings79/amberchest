import { createInterface } from 'node:readline';
import { AmberChestApp, handleRawMessage, logger } from '@amberchest/core';

/**
 * MCP over stdio, the transport Claude Desktop and most editors speak.
 *
 * Configure it there roughly like this:
 *
 *   {
 *     "mcpServers": {
 *       "amberchest": {
 *         "command": "node",
 *         "args": ["/path/to/amberchest/packages/server/dist/mcp-stdio.js"],
 *         "env": { "AMBERCHEST_MASTER_PASSWORD": "..." }
 *       }
 *     }
 *   }
 *
 * Nothing is written to stdout except protocol messages - logs go to stderr,
 * because stdout is the transport.
 */
async function main(): Promise<void> {
  const masterPassword = process.env.AMBERCHEST_MASTER_PASSWORD;
  if (!masterPassword) {
    process.stderr.write(
      'AMBERCHEST_MASTER_PASSWORD is required so the configuration can be unlocked.\n',
    );
    process.exit(1);
  }

  const app = new AmberChestApp();
  if (!app.isInitialized) {
    process.stderr.write('No configuration found. Set up AmberChest first.\n');
    process.exit(1);
  }

  await app.unlock(masterPassword);

  if (!app.getSettings().mcp.enabled) {
    process.stderr.write('MCP is switched off in the AmberChest settings.\n');
    process.exit(1);
  }

  logger.on('entry', (entry) => {
    if (entry.level === 'error' || entry.level === 'warn') {
      process.stderr.write(`[${entry.level}] ${entry.message}\n`);
    }
  });

  const server = app.createMcpServer();
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });

  process.stderr.write('AmberChest MCP server ready on stdio\n');

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

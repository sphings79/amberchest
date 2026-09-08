import { existsSync } from 'node:fs';
import { join } from 'node:path';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import type { MailArchiverApp } from '@mail-archiver/core';
import Fastify, { type FastifyInstance } from 'fastify';
import { AuthGuard } from './auth.js';
import { registerRoutes } from './routes.js';

export interface ServerOptions {
  app: MailArchiverApp;
  auth: AuthGuard;
  /** Directory holding the built frontend; omitted during frontend dev. */
  webRoot?: string | null;
  host?: string;
  port?: number;
  /** Desktop only: hands a file to the operating system. */
  openFile?: ((path: string) => Promise<void>) | undefined;
}

export interface RunningServer {
  server: FastifyInstance;
  url: string;
  port: number;
  close: () => Promise<void>;
}

export async function createServer(options: ServerOptions): Promise<FastifyInstance> {
  const server = Fastify({
    logger: false,
    // Behind a reverse proxy the real client address comes from headers.
    trustProxy: true,
    bodyLimit: 5 * 1024 * 1024,
  });

  await server.register(websocket);
  await registerRoutes(server, {
    app: options.app,
    auth: options.auth,
    openFile: options.openFile,
  });

  if (options.webRoot && existsSync(options.webRoot)) {
    await server.register(fastifyStatic, { root: options.webRoot, index: ['index.html'] });
    // Single page app: unknown non-API paths render the shell.
    server.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) {
        return reply.status(404).send({ error: 'Not found' });
      }
      return reply.sendFile('index.html');
    });
  }

  return server;
}

export async function startServer(options: ServerOptions): Promise<RunningServer> {
  const server = await createServer(options);
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 0;
  await server.listen({ host, port });

  const address = server.addresses()[0];
  const actualPort = address?.port ?? port;
  return {
    server,
    port: actualPort,
    url: `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${actualPort}`,
    close: async () => {
      await server.close();
    },
  };
}

/** Default location of the built frontend inside an installed app. */
export function defaultWebRoot(baseDir: string): string {
  return join(baseDir, 'web');
}

export { AuthGuard } from './auth.js';
export type { AuthMode } from './auth.js';

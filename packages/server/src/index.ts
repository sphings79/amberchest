import { existsSync } from 'node:fs';
import { join } from 'node:path';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import type { AmberChestApp } from '@amberchest/core';
import Fastify, { type FastifyInstance } from 'fastify';
import { isIngressAddress } from './addon.js';
import { AuthGuard } from './auth.js';
import type { LoginLimiter } from './login-limiter.js';
import { registerRoutes } from './routes.js';
import { trustProxyFromEnvironment, type TrustProxy } from './trust-proxy.js';

export interface ServerOptions {
  app: AmberChestApp;
  auth: AuthGuard;
  /** Directory holding the built frontend; omitted during frontend dev. */
  webRoot?: string | null;
  host?: string;
  port?: number;
  /** Desktop only: hands a file to the operating system. */
  openFile?: ((path: string) => Promise<void>) | undefined;
  /**
   * Which proxies may say who the client is. Defaults to the environment, and
   * from there to loopback and private networks; see trust-proxy.ts.
   */
  trustProxy?: TrustProxy | undefined;
  /** Replaces the login limiter; tests use this to control the clock. */
  limiter?: LoginLimiter | undefined;
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
    // Behind a reverse proxy the real client address comes from headers - but
    // only from a proxy of ours, or the address is whatever the client says.
    trustProxy:
      options.trustProxy ?? trustProxyFromEnvironment(process.env.AMBERCHEST_TRUSTED_PROXIES),
    // A transferred message file is the largest body this ever sees.
    bodyLimit: 128 * 1024 * 1024,
  });

  /*
   * Raw bodies, for a transfer from another instance.
   *
   * Fastify refuses a content type it has no parser for, and a message file is
   * exactly that: bytes, to be written as they are.
   */
  server.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer' },
    (_request, body, done) => done(null, body),
  );

  /*
   * Home Assistant ingress: nothing but the supervisor may knock.
   *
   * With ingress there is no login in front of the interface, so the add-on
   * has to make sure it only answers the gateway. Turned on by the add-on when
   * no interface password was configured.
   */
  if (process.env.AMBERCHEST_INGRESS_ONLY === 'true') {
    server.addHook('onRequest', async (request, reply) => {
      // request.ip honours trustProxy, which is not what is wanted here: the
      // socket address is the only thing an outsider cannot forge.
      if (!isIngressAddress(request.socket.remoteAddress ?? undefined)) {
        await reply.status(403).send({ error: 'Only reachable through Home Assistant' });
      }
    });
  }

  /*
   * Headers every answer carries.
   *
   * Nothing from the API belongs in a cache, mail least of all. The frame
   * header keeps the interface out of other sites' pages; the add-on is left
   * alone, because Home Assistant shows it in a frame of its own.
   */
  const asAddon = process.env.AMBERCHEST_ADDON === 'true';
  server.addHook('onSend', async (request, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    if (!asAddon) reply.header('x-frame-options', 'SAMEORIGIN');
    if (request.url.startsWith('/api/')) reply.header('cache-control', 'no-store');
  });

  /*
   * Cross origin access for the remote mode.
   *
   * Authentication is a bearer token, never a cookie, so a foreign page cannot
   * ride along on an existing session - which is what CORS with credentials
   * would risk. Allowing any origin is therefore safe here: without the token
   * every request is rejected anyway.
   */
  server.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    if (!origin) return;

    reply.header('access-control-allow-origin', origin);
    reply.header('vary', 'Origin');
    reply.header('access-control-allow-headers', 'authorization, content-type');
    reply.header('access-control-allow-methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
    reply.header('access-control-max-age', '600');

    if (request.method === 'OPTIONS') {
      await reply.status(204).send();
    }
  });

  // Fastify answers unknown routes with 404 before the hook can reply, so the
  // preflight needs a route of its own.
  server.options('/*', async (_request, reply) => reply.status(204).send());

  await server.register(websocket);
  await registerRoutes(server, {
    app: options.app,
    auth: options.auth,
    openFile: options.openFile,
    limiter: options.limiter,
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

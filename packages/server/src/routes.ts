import {
  handleRawMessage,
  accountInputSchema,
  accountSettingsSchema,
  appSettingsSchema,
  attachmentSettingsSchema,
  describeImapError,
  logger,
  WrongPasswordError,
  type ExportProgress,
  type LogEntry,
  type MailArchiverApp,
  type SyncProgress,
  type ImapConnectionOptions,
} from '@mail-archiver/core';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';
import { z } from 'zod';
import type { AuthGuard } from './auth.js';

const masterPasswordSchema = z.object({ masterPassword: z.string().min(1) });
const loginSchema = z.object({ password: z.string().min(1) });
const foldersSchema = z.object({ folders: z.array(z.string()) });
const connectionSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65_535),
  security: z.enum(['tls', 'starttls', 'none']),
  rejectUnauthorized: z.boolean().default(true),
  username: z.string().min(1),
  password: z.string().default(''),
  /** When set, the stored password of this account is used. */
  accountId: z.string().optional(),
});

export interface RouteOptions {
  app: MailArchiverApp;
  auth: AuthGuard;
  /**
   * Hands a file to the operating system. Only the desktop shell can do this,
   * so in the container the corresponding route reports "not available".
   */
  openFile?: ((path: string) => Promise<void>) | undefined;
}

function fail(reply: FastifyReply, status: number, message: string): FastifyReply {
  return reply.status(status).send({ error: message });
}

const restoreTargetSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65_535),
  security: z.enum(['tls', 'starttls', 'none']),
  rejectUnauthorized: z.boolean().default(true),
  username: z.string().min(1),
  password: z.string().default(''),
  /** Use the stored password of this account instead of sending one. */
  useAccountId: z.string().optional(),
});

const restoreSchema = z.object({
  accountId: z.string().min(1),
  target: restoreTargetSchema,
  mappings: z.array(z.object({ source: z.string(), target: z.string() })),
  selection: z
    .object({
      query: z.string().default(''),
      folders: z.array(z.string()).default([]),
      dateFrom: z.string().nullable().default(null),
      dateTo: z.string().nullable().default(null),
      from: z.string().nullable().default(null),
      withAttachments: z.boolean().default(false),
    })
    .default(() => ({
      query: '',
      folders: [],
      dateFrom: null,
      dateTo: null,
      from: null,
      withAttachments: false,
    })),
  skipExisting: z.boolean().default(true),
  restoreFlags: z.boolean().default(true),
});

const bundleSchema = z.object({
  format: z.enum(['eml-zip', 'mbox', 'pdf-zip']),
  q: z.string().default(''),
  account: z.string().optional(),
  folders: z.array(z.string()).default([]),
  from: z.string().optional(),
  to: z.string().optional(),
  field: z.enum(['all', 'subject', 'from', 'to', 'body', 'attachments']).default('all'),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  withAttachments: z.boolean().default(false),
  unreadOnly: z.boolean().default(false),
  flaggedOnly: z.boolean().default(false),
  minSize: z.number().int().min(0).optional(),
  maxSize: z.number().int().min(0).optional(),
});

const searchQuerySchema = z.object({
  q: z.string().default(''),
  account: z.string().optional(),
  folders: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  field: z.enum(['all', 'subject', 'from', 'to', 'body', 'attachments']).default('all'),
  sort: z.enum(['relevance', 'date-desc', 'date-asc', 'size-desc', 'size-asc']).default('relevance'),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  attachments: z.string().optional(),
  unread: z.string().optional(),
  flagged: z.string().optional(),
  deleted: z.string().optional(),
  minSize: z.coerce.number().int().min(0).optional(),
  maxSize: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function registerRoutes(server: FastifyInstance, options: RouteOptions): Promise<void> {
  const { app, auth } = options;

  /** Every /api route except the public ones needs a valid token. */
  const PUBLIC_PATHS = new Set([
    '/api/health',
    // Carries an unguessable state instead of a token; see the route.
    '/api/oauth/callback',
    '/api/state',
    '/api/login',
    '/api/setup',
    '/api/unlock',
  ]);

  server.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/')) return;
    const path = request.url.split('?')[0] ?? '';
    if (PUBLIC_PATHS.has(path)) return;
    if (!auth.isValid(auth.tokenFromRequest(request))) {
      await fail(reply, 401, 'Not authenticated');
    }
  });

  /** Routes that need an unlocked configuration. */
  const requireUnlocked = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!app.isUnlocked) await fail(reply, 423, 'Configuration is locked');
  };

  /** Health probe for Docker and reverse proxies; never needs a token. */
  server.get('/api/health', async () => ({
    status: 'ok',
    initialized: app.isInitialized,
    unlocked: app.isUnlocked,
  }));

  // ------------------------------------------------------------------ state

  server.get('/api/state', async (request) => {
    const authenticated = auth.isValid(auth.tokenFromRequest(request));
    return {
      initialized: app.isInitialized,
      unlocked: app.isUnlocked,
      authMode: auth.mode,
      authenticated,
      settings: authenticated && app.isUnlocked ? app.getSettings() : null,
    };
  });

  server.post('/api/login', async (request, reply) => {
    const body = loginSchema.safeParse(request.body);
    if (!body.success) return fail(reply, 400, 'Password missing');
    const token = auth.login(body.data.password);
    if (!token) return fail(reply, 401, 'Wrong password');
    return { token };
  });

  server.post('/api/setup', async (request, reply) => {
    if (!auth.isValid(auth.tokenFromRequest(request))) return fail(reply, 401, 'Not authenticated');
    const body = masterPasswordSchema.safeParse(request.body);
    if (!body.success) return fail(reply, 400, 'Master password missing');
    if (app.isInitialized) return fail(reply, 409, 'Configuration already exists');
    if (body.data.masterPassword.length < 8) {
      return fail(reply, 400, 'The master password must be at least 8 characters long');
    }
    await app.initialize(body.data.masterPassword);
    await app.unlock(body.data.masterPassword);
    return { ok: true };
  });

  server.post('/api/unlock', async (request, reply) => {
    if (!auth.isValid(auth.tokenFromRequest(request))) return fail(reply, 401, 'Not authenticated');
    const body = masterPasswordSchema.safeParse(request.body);
    if (!body.success) return fail(reply, 400, 'Master password missing');
    try {
      await app.unlock(body.data.masterPassword);
      return { ok: true };
    } catch (error) {
      if (error instanceof WrongPasswordError) return fail(reply, 401, 'Wrong master password');
      throw error;
    }
  });

  server.post('/api/lock', async () => {
    app.lock();
    return { ok: true };
  });

  // --------------------------------------------------------------- settings

  server.get('/api/settings', { preHandler: requireUnlocked }, async () => app.getSettings());

  server.patch('/api/settings', { preHandler: requireUnlocked }, async (request, reply) => {
    const raw = request.body;
    if (!raw || typeof raw !== 'object') return fail(reply, 400, 'Invalid settings');

    const body = appSettingsSchema.partial().safeParse(raw);
    if (!body.success) return fail(reply, 400, 'Invalid settings');

    /*
     * Only what the client actually sent.
     *
     * A partial schema still fills in the defaults of every section that is
     * missing, so patching the theme alone would quietly reset the archive
     * path, the MCP token and everything else. The parsed values are kept for
     * their coercion, but the keys come from the request.
     */
    const sent = new Set(Object.keys(raw as Record<string, unknown>));
    const patch = Object.fromEntries(
      Object.entries(body.data).filter(([key]) => sent.has(key)),
    ) as Partial<typeof body.data>;

    return app.updateSettings(patch);
  });

  // ----------------------------------------------------------------- archive

  /**
   * Where a message file may be written by a transfer.
   *
   * An endpoint that writes files is only safe with a hard rule about what a
   * path may look like: relative, no traversal, and only the names the archive
   * itself uses.
   */
  const safeArchivePath = (value: string): string[] | null => {
    const segments = value.split('/').filter(Boolean);
    if (segments.length === 0) return null;
    if (segments.some((segment) => segment === '..' || segment === '.' || segment.includes('\\'))) {
      return null;
    }
    if (value.startsWith('/') || /^[a-zA-Z]:/.test(value)) return null;

    const name = segments[segments.length - 1] ?? '';
    if (!name.endsWith('.eml') && !name.startsWith('.mailarchiver')) return null;
    return segments;
  };

  server.get('/api/accounts/:id/archive/manifest', { preHandler: requireUnlocked }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return { files: await app.archiveManifest(id) };
    } catch (error) {
      return fail(reply, 404, (error as Error).message);
    }
  });

  server.put('/api/accounts/:id/archive/file', { preHandler: requireUnlocked }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { path } = request.query as { path?: string };
    if (!path) return fail(reply, 400, 'No path');

    const segments = safeArchivePath(path);
    if (!segments) return fail(reply, 400, 'That path is not allowed');

    const body = request.body;
    if (!Buffer.isBuffer(body)) return fail(reply, 400, 'Expected a file body');

    try {
      await app.writeArchiveFile(id, segments, body);
      return { ok: true };
    } catch (error) {
      return fail(reply, 400, (error as Error).message);
    }
  });

  server.post('/api/accounts/:id/adopt', { preHandler: requireUnlocked }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z
      .object({
        askServer: z.boolean().default(false),
        includeDeleted: z.boolean().default(false),
      })
      .safeParse(request.body ?? {});
    if (!body.success) return fail(reply, 400, 'Invalid request');
    if (app.adopt.isRunning) return fail(reply, 409, 'An adoption is already running');

    try {
      const result = await app.startAdopt(id, body.data);
      return { phase: result.phase, stats: result.stats, guessedFolders: result.guessedFolders };
    } catch (error) {
      return fail(reply, 400, (error as Error).message);
    }
  });

  server.post('/api/accounts/:id/transfer', { preHandler: requireUnlocked }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z
      .object({
        url: z.string().min(1),
        token: z.string().default(''),
        accountId: z.string().min(1),
        includeDeleted: z.boolean().default(false),
      })
      .safeParse(request.body);
    if (!body.success) return fail(reply, 400, 'Invalid request');
    if (app.transfer.isRunning) return fail(reply, 409, 'A transfer is already running');

    // Runs on; the interface follows over the websocket.
    void app
      .startTransfer(
        id,
        { url: body.data.url, token: body.data.token, accountId: body.data.accountId },
        { includeDeleted: body.data.includeDeleted },
      )
      .catch((error: Error) => logger.error(`Transfer failed: ${error.message}`));
    return { started: true };
  });

  server.post('/api/accounts/:id/transfer/cancel', { preHandler: requireUnlocked }, async () => ({
    cancelled: app.transfer.cancel(),
  }));

  server.post('/api/accounts/:id/register', { preHandler: requireUnlocked }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return await app.writeRegister(id);
    } catch (error) {
      return fail(reply, 400, (error as Error).message);
    }
  });

  // ------------------------------------------------------------- statistics

  server.get('/api/statistics', { preHandler: requireUnlocked }, async (request, reply) => {
    const query = request.query as { account?: string };
    try {
      return app.statistics(query.account ?? null);
    } catch (error) {
      return fail(reply, 404, (error as Error).message);
    }
  });

  // ---------------------------------------------------------------- storage

  server.get('/api/storage', { preHandler: requireUnlocked }, async () => app.storageStatus());

  // ---------------------------------------------------------- notifications

  server.post('/api/notifications/test', { preHandler: requireUnlocked }, async () => {
    const result = await app.notifier.trySend({
      event: 'test',
      level: 'info',
      title: 'Mail Archiver: test',
      message: 'If you are reading this, the notification works.',
    });
    return result;
  });

  // ----------------------------------------------------------------- verify

  server.post('/api/accounts/:id/verify', { preHandler: requireUnlocked }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z
      .object({ checkServer: z.boolean().default(false), includeDeleted: z.boolean().default(false) })
      .safeParse(request.body ?? {});
    if (!body.success) return fail(reply, 400, 'Invalid request');
    if (app.verify.isRunning(id)) return fail(reply, 409, 'A verification is already running');

    try {
      app.requireAccount(id);
    } catch {
      return fail(reply, 404, 'Unknown account');
    }

    // Runs on; the interface follows along over the websocket.
    void app.startVerify(id, body.data).catch((error: Error) => {
      logger.error(`Verification failed: ${error.message}`);
    });
    return { started: true };
  });

  server.post('/api/accounts/:id/verify/cancel', { preHandler: requireUnlocked }, async (request) => {
    const { id } = request.params as { id: string };
    return { cancelled: app.cancelVerify(id) };
  });

  server.get('/api/accounts/:id/verify', { preHandler: requireUnlocked }, async (request) => {
    const { id } = request.params as { id: string };
    return { run: app.lastVerify(id), running: app.verify.isRunning(id) };
  });

  // ------------------------------------------------------------------ oauth

  const oauthProviderSchema = z.enum(['google', 'microsoft', 'custom']);

  server.get('/api/oauth/providers', { preHandler: requireUnlocked }, async () => {
    const settings = app.getSettings().oauth;
    return {
      redirectMode: settings.redirectMode,
      publicRedirectUri: settings.publicRedirectUri,
      // The callback route of this instance, so the settings screen can show
      // what has to be registered with the provider.
      callbackPath: '/api/oauth/callback',
      providers: (['google', 'microsoft', 'custom'] as const).map((id) => {
        const provider = app.oauth.provider(id);
        return {
          id,
          name: provider.name,
          deviceFlow: Boolean(provider.deviceEndpoint),
          scopes: provider.scopes,
          imapHost: provider.imapHost,
          imapPort: provider.imapPort,
          configured: settings[id].clientId.length > 0,
          clientSecretUsed: provider.clientSecretUsed,
        };
      }),
    };
  });

  server.post('/api/accounts/:id/oauth/device', { preHandler: requireUnlocked }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z.object({ provider: oauthProviderSchema }).safeParse(request.body);
    if (!body.success) return fail(reply, 400, 'Invalid provider');

    try {
      return await app.oauth.startDevice(id, body.data.provider);
    } catch (error) {
      return fail(reply, 400, (error as Error).message);
    }
  });

  server.get('/api/accounts/:id/oauth/device', { preHandler: requireUnlocked }, async (request) => {
    const { id } = request.params as { id: string };
    return app.oauth.pollDevice(id);
  });

  server.post('/api/accounts/:id/oauth/authorize', { preHandler: requireUnlocked }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z
      .object({
        provider: oauthProviderSchema,
        mode: z.enum(['loopback', 'public']).optional(),
        loopbackPort: z.number().int().min(1).max(65_535).optional(),
      })
      .safeParse(request.body);
    if (!body.success) return fail(reply, 400, 'Invalid request');

    try {
      return app.oauth.startAuthorization(id, body.data.provider, {
        ...(body.data.mode ? { mode: body.data.mode } : {}),
        ...(body.data.loopbackPort ? { loopbackPort: body.data.loopbackPort } : {}),
      });
    } catch (error) {
      return fail(reply, 400, (error as Error).message);
    }
  });

  /** Takes the code, or the whole address the browser ended up on. */
  server.post('/api/oauth/complete', { preHandler: requireUnlocked }, async (request, reply) => {
    const body = z.object({ input: z.string().min(1), state: z.string().optional() }).safeParse(request.body);
    if (!body.success) return fail(reply, 400, 'Nothing to read a code from');

    try {
      const accountId = await app.oauth.completeAuthorization(
        body.data.input,
        body.data.state,
      );
      return { accountId };
    } catch (error) {
      return fail(reply, 400, (error as Error).message);
    }
  });

  /**
   * Where the provider sends the browser back to, for the public redirect.
   *
   * No bearer token can travel through a redirect, so this route is open - the
   * unguessable state is what protects it, and an unknown one is refused.
   */
  server.get('/api/oauth/callback', async (request, reply) => {
    const query = request.query as { code?: string; state?: string; error?: string };
    const done = (title: string, message: string): void => {
      void reply.type('text/html').send(
        `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
          '<style>body{font-family:system-ui,sans-serif;background:#0d0f14;color:#e8eaf0;' +
          'display:grid;place-items:center;height:100vh;margin:0}div{max-width:32rem;text-align:center}' +
          'h1{font-size:1.25rem}p{color:#9aa2b5}</style>' +
          `<div><h1>${title}</h1><p>${message}</p></div>`,
      );
    };

    if (query.error) return done('Not connected', `The provider answered: ${query.error}`);
    if (!query.code || !query.state) return done('Not connected', 'The address carried no code.');

    try {
      await app.oauth.completeAuthorization(query.code, query.state);
      return done('Connected', 'You can close this tab and go back to Mail Archiver.');
    } catch (error) {
      return done('Not connected', (error as Error).message);
    }
  });

  // --------------------------------------------------------------- schedule

  server.get('/api/schedule', { preHandler: requireUnlocked }, async () => app.scheduleInfo());

  // ------------------------------------------------------------------- mqtt

  server.get('/api/mqtt', { preHandler: requireUnlocked }, async () => app.mqttStatus());

  /** Applies the stored settings again, which reconnects with a clean slate. */
  server.post('/api/mqtt/reconnect', { preHandler: requireUnlocked }, async () => {
    await app.mqtt.apply();
    return app.mqttStatus();
  });

  server.post('/api/mqtt/publish', { preHandler: requireUnlocked }, async () => {
    await app.mqtt.publishState();
    return app.mqttStatus();
  });

  // --------------------------------------------------------------- accounts

  server.get('/api/accounts', { preHandler: requireUnlocked }, async () => app.overview());

  server.post('/api/accounts', { preHandler: requireUnlocked }, async (request, reply) => {
    const body = accountInputSchema.safeParse(request.body);
    if (!body.success) return fail(reply, 400, body.error.issues[0]?.message ?? 'Invalid account');
    return app.addAccount(body.data);
  });

  server.patch('/api/accounts/:id', { preHandler: requireUnlocked }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = accountInputSchema.partial().safeParse(request.body);
    if (!body.success) return fail(reply, 400, body.error.issues[0]?.message ?? 'Invalid account');
    try {
      return await app.updateAccount(id, body.data);
    } catch (error) {
      return fail(reply, 404, (error as Error).message);
    }
  });

  server.patch('/api/accounts/:id/settings', { preHandler: requireUnlocked }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = accountSettingsSchema.partial().safeParse(request.body);
    if (!body.success) return fail(reply, 400, 'Invalid account settings');
    try {
      return await app.updateAccount(id, { settings: body.data });
    } catch (error) {
      return fail(reply, 404, (error as Error).message);
    }
  });

  server.delete('/api/accounts/:id', { preHandler: requireUnlocked }, async (request) => {
    const { id } = request.params as { id: string };
    await app.deleteAccount(id);
    return { ok: true };
  });

  server.post('/api/accounts/test', { preHandler: requireUnlocked }, async (request, reply) => {
    const body = connectionSchema.safeParse(request.body);
    if (!body.success) return fail(reply, 400, 'Incomplete connection details');

    let password = body.data.password;
    let accessToken: string | undefined;

    if (body.data.accountId) {
      try {
        const account = app.requireAccount(body.data.accountId);
        // An account that authenticates with a token has no password to fall
        // back on, so the test needs a fresh one.
        if (account.authType === 'oauth') {
          accessToken = (await app.connectionFor(account)).accessToken;
        } else if (!password) {
          password = account.password;
        }
      } catch (error) {
        return fail(reply, 400, (error as Error).message);
      }
    }

    return app.testConnection({
      host: body.data.host,
      port: body.data.port,
      security: body.data.security,
      rejectUnauthorized: body.data.rejectUnauthorized,
      username: body.data.username,
      password,
      ...(accessToken ? { accessToken } : {}),
    });
  });

  // ---------------------------------------------------------------- folders

  server.get('/api/accounts/:id/folders', { preHandler: requireUnlocked }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as { counts?: string };
    try {
      return await app.getFolderTree(id, query.counts === '1');
    } catch (error) {
      return fail(reply, 502, describeImapError(error));
    }
  });

  /** Archived folders, read from the index - no connection to the server. */
  server.get('/api/accounts/:id/local-folders', { preHandler: requireUnlocked }, async (request) => {
    const { id } = request.params as { id: string };
    return app.localFolders(id);
  });

  server.put('/api/accounts/:id/folders', { preHandler: requireUnlocked }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = foldersSchema.safeParse(request.body);
    if (!body.success) return fail(reply, 400, 'Invalid folder list');
    await app.setSelectedFolders(id, body.data.folders);
    return { ok: true };
  });

  // ------------------------------------------------------------------- sync

  server.post('/api/accounts/:id/sync', { preHandler: requireUnlocked }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (app.sync.isRunning(id)) return fail(reply, 409, 'A backup is already running');
    // Fire and forget: progress arrives over the websocket.
    void app.startSyncAndIndex(id).catch(() => undefined);
    return { started: true };
  });

  server.post('/api/accounts/:id/sync/cancel', { preHandler: requireUnlocked }, async (request) => {
    const { id } = request.params as { id: string };
    return { cancelled: app.cancelSync(id) };
  });

  server.get('/api/accounts/:id/runs', { preHandler: requireUnlocked }, async (request) => {
    const { id } = request.params as { id: string };
    return app.db.listRuns(id, 25);
  });

  // ------------------------------------------------------------ attachments

  server.get('/api/accounts/:id/attachments', { preHandler: requireUnlocked }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const stats = app.db.countAttachments(id);
      return {
        settings: app.getAttachmentSettings(id),
        files: stats.files,
        bytes: stats.bytes,
        running: app.exports.isRunning(id),
        progress: app.exports.getProgress(id) ?? null,
        runs: app.db.listExportRuns(id, 5),
      };
    } catch (error) {
      return fail(reply, 404, (error as Error).message);
    }
  });

  server.patch('/api/accounts/:id/attachments', { preHandler: requireUnlocked }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = attachmentSettingsSchema.partial().safeParse(request.body);
    if (!body.success) return fail(reply, 400, 'Invalid attachment settings');
    try {
      return await app.updateAttachmentSettings(id, body.data);
    } catch (error) {
      return fail(reply, 404, (error as Error).message);
    }
  });

  server.post('/api/accounts/:id/attachments/export', { preHandler: requireUnlocked }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (app.exports.isRunning(id)) return fail(reply, 409, 'An export is already running');
    void app.startAttachmentExport(id).catch(() => undefined);
    return { started: true };
  });

  server.post(
    '/api/accounts/:id/attachments/export/cancel',
    { preHandler: requireUnlocked },
    async (request) => {
      const { id } = request.params as { id: string };
      return { cancelled: app.cancelAttachmentExport(id) };
    },
  );

  server.post('/api/accounts/:id/attachments/reset', { preHandler: requireUnlocked }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (app.exports.isRunning(id)) return fail(reply, 409, 'An export is already running');
    app.resetAttachmentExport(id);
    return { ok: true };
  });

  // ---------------------------------------------------------- search

  server.get('/api/search', { preHandler: requireUnlocked }, async (request, reply) => {
    const parsed = searchQuerySchema.safeParse(request.query);
    if (!parsed.success) return fail(reply, 400, 'Invalid search parameters');
    const query = parsed.data;

    return app.search({
      query: query.q,
      accountId: query.account ?? null,
      folders: query.folders ? query.folders.split('\n').filter(Boolean) : [],
      from: query.from ?? null,
      to: query.to ?? null,
      field: query.field,
      sort: query.sort,
      dateFrom: query.dateFrom ?? null,
      dateTo: query.dateTo ?? null,
      withAttachments: query.attachments === '1',
      unreadOnly: query.unread === '1',
      flaggedOnly: query.flagged === '1',
      includeDeleted: query.deleted === '1',
      minSize: query.minSize ?? null,
      maxSize: query.maxSize ?? null,
      limit: query.limit,
      offset: query.offset,
    });
  });

  server.get('/api/accounts/:id/messages/:messageId', { preHandler: requireUnlocked }, async (request, reply) => {
    const { id, messageId } = request.params as { id: string; messageId: string };
    try {
      return await app.loadMessage(id, Number(messageId));
    } catch (error) {
      return fail(reply, 404, (error as Error).message);
    }
  });

  server.get('/api/accounts/:id/messages/:messageId/raw', { preHandler: requireUnlocked }, async (request, reply) => {
    const { id, messageId } = request.params as { id: string; messageId: string };
    try {
      const message = await app.loadMessageSource(id, Number(messageId));
      return reply
        .header('content-type', 'message/rfc822')
        .header('content-disposition', `attachment; filename="${encodeURIComponent(message.fileName)}"`)
        .send(message.source);
    } catch (error) {
      return fail(reply, 404, (error as Error).message);
    }
  });

  server.get(
    '/api/accounts/:id/messages/:messageId/attachments/:index',
    { preHandler: requireUnlocked },
    async (request, reply) => {
      const { id, messageId, index } = request.params as {
        id: string;
        messageId: string;
        index: string;
      };
      try {
        const attachment = await app.loadAttachment(id, Number(messageId), Number(index));
        return reply
          .header('content-type', attachment.contentType)
          .header('content-disposition', `attachment; filename="${encodeURIComponent(attachment.name)}"`)
          .send(attachment.content);
      } catch (error) {
        return fail(reply, 404, (error as Error).message);
      }
    },
  );

  server.get('/api/accounts/:id/messages/:messageId/pdf', { preHandler: requireUnlocked }, async (request, reply) => {
    const { id, messageId } = request.params as { id: string; messageId: string };
    try {
      const pdf = await app.messageToPdf(id, Number(messageId));
      return reply
        .header('content-type', 'application/pdf')
        .header('content-disposition', `attachment; filename="${encodeURIComponent(pdf.fileName)}"`)
        .send(pdf.content);
    } catch (error) {
      return fail(reply, 501, (error as Error).message);
    }
  });

  /** Opens the stored .eml in whatever mail client the desktop has. */
  server.post('/api/accounts/:id/messages/:messageId/open', { preHandler: requireUnlocked }, async (request, reply) => {
    if (!options.openFile) {
      return fail(reply, 501, 'Only available in the desktop app');
    }
    const { id, messageId } = request.params as { id: string; messageId: string };
    try {
      const message = await app.loadMessageSource(id, Number(messageId));
      await options.openFile(message.filePath);
      return { opened: true };
    } catch (error) {
      return fail(reply, 404, (error as Error).message);
    }
  });

  // ---------------------------------------------------------------- restore

  /**
   * Resolves the credentials for a restore target.
   *
   * "Use the stored account" also covers an account that authenticates with a
   * token, which is why this goes through the application rather than reading
   * the password out of the configuration.
   */
  const resolveTarget = async (
    target: z.infer<typeof restoreTargetSchema>,
  ): Promise<ImapConnectionOptions> => {
    const base = {
      host: target.host,
      port: target.port,
      security: target.security,
      rejectUnauthorized: target.rejectUnauthorized,
      username: target.username,
    };

    if (target.useAccountId) {
      const account = app.requireAccount(target.useAccountId);
      const connection = await app.connectionFor(account);
      return {
        ...base,
        password: target.password || connection.password,
        ...(connection.accessToken ? { accessToken: connection.accessToken } : {}),
      };
    }

    return { ...base, password: target.password };
  };

  server.post('/api/restore/mappings', { preHandler: requireUnlocked }, async (request, reply) => {
    const body = z
      .object({ accountId: z.string().min(1), target: restoreTargetSchema })
      .safeParse(request.body);
    if (!body.success) return fail(reply, 400, 'Invalid request');

    try {
      return await app.suggestRestoreMappings(
        body.data.accountId,
        await resolveTarget(body.data.target),
      );
    } catch (error) {
      return fail(reply, 502, describeImapError(error));
    }
  });

  server.post('/api/restore', { preHandler: requireUnlocked }, async (request, reply) => {
    const body = restoreSchema.safeParse(request.body);
    if (!body.success) return fail(reply, 400, body.error.issues[0]?.message ?? 'Invalid request');
    if (app.restore.isRunning) return fail(reply, 409, 'A restore is already running');

    void app
      .startRestore({
        accountId: body.data.accountId,
        target: await resolveTarget(body.data.target),
        mappings: body.data.mappings,
        selection: body.data.selection,
        skipExisting: body.data.skipExisting,
        restoreFlags: body.data.restoreFlags,
      })
      .catch(() => undefined);

    return { started: true };
  });

  server.post('/api/restore/cancel', { preHandler: requireUnlocked }, async () => ({
    cancelled: app.cancelRestore(),
  }));

  server.get('/api/restore', { preHandler: requireUnlocked }, async () => ({
    running: app.restore.isRunning,
    progress: app.restore.progress,
  }));

  // ------------------------------------------------------- archive encryption

  server.get('/api/archive/migration', { preHandler: requireUnlocked }, async () => ({
    running: app.migration.isRunning,
    progress: app.migration.progress,
  }));

  server.post('/api/archive/migration', { preHandler: requireUnlocked }, async (request, reply) => {
    const body = z.object({ direction: z.enum(['encrypt', 'decrypt']) }).safeParse(request.body);
    if (!body.success) return fail(reply, 400, 'Invalid direction');
    if (app.migration.isRunning) return fail(reply, 409, 'A migration is already running');

    void app.startEncryptionMigration(body.data.direction).catch(() => undefined);
    return { started: true };
  });

  server.post('/api/archive/migration/cancel', { preHandler: requireUnlocked }, async () => ({
    cancelled: app.cancelEncryptionMigration(),
  }));

  // -------------------------------------------------------------------- mcp

  /**
   * MCP over HTTP. Guarded by its own token so enabling MCP does not hand out
   * the whole application API, and switched off unless the user asked for it.
   */
  server.post('/mcp', async (request, reply) => {
    if (!app.isUnlocked) return fail(reply, 423, 'Configuration is locked');

    const settings = app.getSettings().mcp;
    if (!settings.enabled || !settings.httpEnabled) {
      return fail(reply, 404, 'MCP over HTTP is not enabled');
    }

    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
    if (!settings.token || token !== settings.token) {
      return fail(reply, 401, 'Invalid MCP token');
    }

    const mcp = app.createMcpServer();
    const response = await mcp.handle(request.body as never);
    // Notifications produce no answer at all.
    if (!response) return reply.status(202).send();
    return reply.header('content-type', 'application/json').send(response);
  });

  // ---------------------------------------------------------- export files

  server.get('/api/exports', { preHandler: requireUnlocked }, async () => ({
    pdfAvailable: await app.pdfAvailable(),
    bundles: app.bundles.list(),
  }));

  server.post('/api/exports', { preHandler: requireUnlocked }, async (request, reply) => {
    const body = bundleSchema.safeParse(request.body);
    if (!body.success) return fail(reply, 400, 'Invalid export request');

    if (body.data.format === 'pdf-zip' && !(await app.pdfAvailable())) {
      return fail(reply, 501, 'PDF export needs Chromium, which is not available here');
    }

    const bundleId = app.startBundle(body.data.format, {
      query: body.data.q,
      accountId: body.data.account ?? null,
      folders: body.data.folders,
      from: body.data.from ?? null,
      to: body.data.to ?? null,
      field: body.data.field,
      dateFrom: body.data.dateFrom ?? null,
      dateTo: body.data.dateTo ?? null,
      withAttachments: body.data.withAttachments,
      unreadOnly: body.data.unreadOnly,
      flaggedOnly: body.data.flaggedOnly,
      minSize: body.data.minSize ?? null,
      maxSize: body.data.maxSize ?? null,
    });
    return { bundleId };
  });

  server.post('/api/exports/:bundleId/cancel', { preHandler: requireUnlocked }, async (request) => {
    const { bundleId } = request.params as { bundleId: string };
    return { cancelled: app.bundles.cancel(bundleId) };
  });

  server.get('/api/exports/:bundleId/download', { preHandler: requireUnlocked }, async (request, reply) => {
    const { bundleId } = request.params as { bundleId: string };
    const bundle = app.bundles.get(bundleId);
    if (!bundle) return fail(reply, 404, 'Unknown export');

    const { createReadStream } = await import('node:fs');
    return reply
      .header('content-type', 'application/octet-stream')
      .header('content-disposition', `attachment; filename="${encodeURIComponent(bundle.fileName)}"`)
      .send(createReadStream(bundle.path));
  });

  // ----------------------------------------------------------- index

  server.post('/api/accounts/:id/index', { preHandler: requireUnlocked }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (app.index.isRunning(id)) return fail(reply, 409, 'Indexing is already running');
    void app.startIndexing(id).catch(() => undefined);
    return { started: true };
  });

  server.post('/api/accounts/:id/index/cancel', { preHandler: requireUnlocked }, async (request) => {
    const { id } = request.params as { id: string };
    return { cancelled: app.cancelIndexing(id) };
  });

  server.post('/api/accounts/:id/index/reset', { preHandler: requireUnlocked }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (app.index.isRunning(id)) return fail(reply, 409, 'Indexing is already running');
    app.resetIndex(id);
    return { ok: true };
  });

  server.get('/api/runs', { preHandler: requireUnlocked }, async (request) => {
    const query = request.query as { limit?: string };
    return app.db.listRecentRuns(Number(query.limit ?? 10));
  });

  server.get('/api/logs', async (request) => {
    const query = request.query as { limit?: string };
    return logger.recent(Number(query.limit ?? 300));
  });

  // ----------------------------------------------------------------- events

  server.get('/api/events', { websocket: true }, (socket: WebSocket, request: FastifyRequest) => {
    if (!auth.isValid(auth.tokenFromRequest(request))) {
      socket.close(4401, 'Not authenticated');
      return;
    }

    const send = (type: string, payload: unknown): void => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ type, payload }));
    };

    for (const progress of app.sync.allProgress()) send('progress', progress);
    for (const progress of app.exports.allProgress()) send('export-progress', progress);
    for (const progress of app.index.allProgress()) send('index-progress', progress);

    const onProgress = (progress: SyncProgress): void => send('progress', progress);
    const onExportProgress = (progress: ExportProgress): void => send('export-progress', progress);
    const onIndexProgress = (progress: unknown): void => send('index-progress', progress);
    const onBundleProgress = (progress: unknown): void => send('bundle-progress', progress);
    const onRestoreProgress = (progress: unknown): void => send('restore-progress', progress);
    const onMigrationProgress = (progress: unknown): void => send('migration-progress', progress);
    const onVerifyProgress = (progress: unknown): void => send('verify-progress', progress);
    const onAdoptProgress = (progress: unknown): void => send('adopt-progress', progress);
    const onTransferProgress = (progress: unknown): void => send('transfer-progress', progress);
    const onLog = (entry: LogEntry): void => send('log', entry);

    app.sync.on('progress', onProgress);
    app.exports.on('progress', onExportProgress);
    app.index.on('progress', onIndexProgress);
    app.bundles.on('progress', onBundleProgress);
    app.restore.on('progress', onRestoreProgress);
    app.migration.on('progress', onMigrationProgress);
    app.verify.on('progress', onVerifyProgress);
    app.adopt.on('progress', onAdoptProgress);
    app.transfer.on('progress', onTransferProgress);
    logger.on('entry', onLog);

    socket.on('close', () => {
      app.sync.off('progress', onProgress);
      app.exports.off('progress', onExportProgress);
      app.index.off('progress', onIndexProgress);
      app.bundles.off('progress', onBundleProgress);
      app.restore.off('progress', onRestoreProgress);
      app.migration.off('progress', onMigrationProgress);
      app.verify.off('progress', onVerifyProgress);
      app.adopt.off('progress', onAdoptProgress);
      app.transfer.off('progress', onTransferProgress);
      logger.off('entry', onLog);
    });
  });
}

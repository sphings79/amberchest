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
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  withAttachments: z.boolean().default(false),
});

const searchQuerySchema = z.object({
  q: z.string().default(''),
  account: z.string().optional(),
  folders: z.string().optional(),
  from: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  attachments: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function registerRoutes(server: FastifyInstance, options: RouteOptions): Promise<void> {
  const { app, auth } = options;

  /** Every /api route except the public ones needs a valid token. */
  const PUBLIC_PATHS = new Set([
    '/api/health',
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
    const body = appSettingsSchema.partial().safeParse(request.body);
    if (!body.success) return fail(reply, 400, 'Invalid settings');
    return app.updateSettings(body.data);
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
    if (!password && body.data.accountId) {
      try {
        password = app.requireAccount(body.data.accountId).password;
      } catch {
        return fail(reply, 404, 'Unknown account');
      }
    }

    return app.testConnection({
      host: body.data.host,
      port: body.data.port,
      security: body.data.security,
      rejectUnauthorized: body.data.rejectUnauthorized,
      username: body.data.username,
      password,
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
      dateFrom: query.dateFrom ?? null,
      dateTo: query.dateTo ?? null,
      withAttachments: query.attachments === '1',
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

  /** Resolves the password for a restore target from the request or storage. */
  const resolveTarget = (
    target: z.infer<typeof restoreTargetSchema>,
  ): {
    host: string;
    port: number;
    security: 'tls' | 'starttls' | 'none';
    rejectUnauthorized: boolean;
    username: string;
    password: string;
  } => {
    const password = target.password || (target.useAccountId
      ? app.requireAccount(target.useAccountId).password
      : '');
    return {
      host: target.host,
      port: target.port,
      security: target.security,
      rejectUnauthorized: target.rejectUnauthorized,
      username: target.username,
      password,
    };
  };

  server.post('/api/restore/mappings', { preHandler: requireUnlocked }, async (request, reply) => {
    const body = z
      .object({ accountId: z.string().min(1), target: restoreTargetSchema })
      .safeParse(request.body);
    if (!body.success) return fail(reply, 400, 'Invalid request');

    try {
      return await app.suggestRestoreMappings(body.data.accountId, resolveTarget(body.data.target));
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
        target: resolveTarget(body.data.target),
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
      dateFrom: body.data.dateFrom ?? null,
      dateTo: body.data.dateTo ?? null,
      withAttachments: body.data.withAttachments,
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
    const onLog = (entry: LogEntry): void => send('log', entry);

    app.sync.on('progress', onProgress);
    app.exports.on('progress', onExportProgress);
    app.index.on('progress', onIndexProgress);
    app.bundles.on('progress', onBundleProgress);
    app.restore.on('progress', onRestoreProgress);
    logger.on('entry', onLog);

    socket.on('close', () => {
      app.sync.off('progress', onProgress);
      app.exports.off('progress', onExportProgress);
      app.index.off('progress', onIndexProgress);
      app.bundles.off('progress', onBundleProgress);
      app.restore.off('progress', onRestoreProgress);
      logger.off('entry', onLog);
    });
  });
}

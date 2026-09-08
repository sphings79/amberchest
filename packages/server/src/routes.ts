import {
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
}

function fail(reply: FastifyReply, status: number, message: string): FastifyReply {
  return reply.status(status).send({ error: message });
}

export async function registerRoutes(server: FastifyInstance, options: RouteOptions): Promise<void> {
  const { app, auth } = options;

  /** Every /api route except the public ones needs a valid token. */
  const PUBLIC_PATHS = new Set(['/api/state', '/api/login', '/api/setup', '/api/unlock']);

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
    void app.startSync(id).catch(() => undefined);
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

    const onProgress = (progress: SyncProgress): void => send('progress', progress);
    const onExportProgress = (progress: ExportProgress): void => send('export-progress', progress);
    const onLog = (entry: LogEntry): void => send('log', entry);

    app.sync.on('progress', onProgress);
    app.exports.on('progress', onExportProgress);
    logger.on('entry', onLog);

    socket.on('close', () => {
      app.sync.off('progress', onProgress);
      app.exports.off('progress', onExportProgress);
      logger.off('entry', onLog);
    });
  });
}

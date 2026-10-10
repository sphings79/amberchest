import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { appSettingsSchema, type AmberChestApp } from '@amberchest/core';
import { AuthGuard, viewerMayCall } from '../src/auth.js';
import { createServer } from '../src/index.js';

describe('sessions and tickets over time', () => {
  function guard(): { auth: AuthGuard; advance: (ms: number) => void } {
    let clock = 1_000_000;
    const auth = AuthGuard.fromEnvironment(
      { AMBERCHEST_UI_PASSWORD: 'admin-pw', AMBERCHEST_UI_PASSWORD_READONLY: 'viewer-pw' },
      () => clock,
    );
    return { auth, advance: (ms) => void (clock += ms) };
  }

  it('lets an admin session run out after twelve hours, a viewer after a week', () => {
    const { auth, advance } = guard();
    const admin = auth.login('admin-pw');
    const viewer = auth.login('viewer-pw');

    advance(11 * 60 * 60 * 1000);
    expect(auth.roleOf(admin?.token)).toBe('admin');

    advance(2 * 60 * 60 * 1000);
    expect(auth.roleOf(admin?.token)).toBeNull();
    expect(auth.roleOf(viewer?.token)).toBe('viewer');

    advance(7 * 24 * 60 * 60 * 1000);
    expect(auth.roleOf(viewer?.token)).toBeNull();
  });

  it('never lets the desktop token run out', () => {
    let clock = 0;
    const auth = new AuthGuard('token', 'desktop', null, () => clock);
    clock += 365 * 24 * 60 * 60 * 1000;
    expect(auth.roleOf('desktop')).toBe('admin');
  });

  it('lets a ticket go stale after a minute', () => {
    const { auth, advance } = guard();
    const session = auth.login('admin-pw');
    const ticket = auth.issueTicket(session?.token, '/api/accounts');
    advance(61 * 1000);
    expect(auth.redeemTicket(ticket, '/api/accounts')).toBeNull();

    const fresh = auth.issueTicket(session?.token, '/api/accounts');
    expect(auth.redeemTicket(fresh, '/api/accounts')).toBe('admin');
  });
});

describe('AuthGuard roles', () => {
  it('lets everything through as admin when there is no password', () => {
    const auth = AuthGuard.fromEnvironment({});
    expect(auth.roleOf(null)).toBe('admin');
    expect(auth.roleOf('anything')).toBe('admin');
  });

  const env = {
    AMBERCHEST_UI_PASSWORD: 'admin-pw',
    AMBERCHEST_UI_PASSWORD_READONLY: 'viewer-pw',
  };

  it('logs in as admin or viewer depending on the password', () => {
    const auth = AuthGuard.fromEnvironment(env);
    expect(auth.hasViewer).toBe(true);

    const admin = auth.login('admin-pw');
    const viewer = auth.login('viewer-pw');
    expect(admin?.role).toBe('admin');
    expect(viewer?.role).toBe('viewer');
    expect(auth.roleOf(admin?.token)).toBe('admin');
    expect(auth.roleOf(viewer?.token)).toBe('viewer');
    expect(auth.login('nope')).toBeNull();
    expect(auth.roleOf('made-up')).toBeNull();
  });

  it('ignores a viewer password that equals the admin password', () => {
    const auth = AuthGuard.fromEnvironment({
      AMBERCHEST_UI_PASSWORD: 'same',
      AMBERCHEST_UI_PASSWORD_READONLY: 'same',
    });
    expect(auth.hasViewer).toBe(false);
    expect(auth.login('same')?.role).toBe('admin');
  });

  it('has no viewer without an admin password', () => {
    const auth = AuthGuard.fromEnvironment({ AMBERCHEST_UI_PASSWORD_READONLY: 'viewer-pw' });
    expect(auth.mode).toBe('none');
    expect(auth.hasViewer).toBe(false);
    expect(auth.login('viewer-pw')).toBeNull();
  });

  it('drops a session on logout, but keeps the desktop token', () => {
    const auth = AuthGuard.fromEnvironment(env);
    const session = auth.login('viewer-pw');
    auth.logout(session?.token ?? '');
    expect(auth.roleOf(session?.token)).toBeNull();

    const desktop = AuthGuard.withToken('desktop');
    desktop.logout('desktop');
    expect(desktop.roleOf('desktop')).toBe('admin');
  });
});

describe('viewerMayCall', () => {
  it('lets a viewer read and download', () => {
    expect(viewerMayCall('GET', '/api/accounts')).toBe(true);
    expect(viewerMayCall('GET', '/api/search')).toBe(true);
    expect(viewerMayCall('GET', '/api/accounts/a1/local-folders')).toBe(true);
    expect(viewerMayCall('GET', '/api/accounts/a1/messages/42')).toBe(true);
    expect(viewerMayCall('GET', '/api/accounts/a1/messages/42/raw')).toBe(true);
    expect(viewerMayCall('GET', '/api/accounts/a1/messages/42/pdf')).toBe(true);
    expect(viewerMayCall('GET', '/api/accounts/a1/messages/42/attachments/0')).toBe(true);
    expect(viewerMayCall('POST', '/api/exports')).toBe(true);
    expect(viewerMayCall('GET', '/api/exports/b1/download')).toBe(true);
    expect(viewerMayCall('POST', '/api/logout')).toBe(true);
  });

  it('keeps a viewer away from everything that changes something', () => {
    const denied: Array<[string, string]> = [
      ['PATCH', '/api/settings'],
      ['GET', '/api/settings'],
      ['POST', '/api/accounts'],
      ['PATCH', '/api/accounts/a1'],
      ['DELETE', '/api/accounts/a1'],
      ['GET', '/api/accounts/a1/folders'],
      ['PUT', '/api/accounts/a1/folders'],
      ['POST', '/api/accounts/a1/sync'],
      ['POST', '/api/accounts/a1/messages/42/discard'],
      ['POST', '/api/accounts/a1/messages/42/open'],
      ['POST', '/api/accounts/a1/attachments/export'],
      ['POST', '/api/restore'],
      ['POST', '/api/accounts/a1/transfer'],
      ['PUT', '/api/accounts/a1/archive/file'],
      ['POST', '/api/lock'],
      ['GET', '/api/logs'],
      ['GET', '/api/discarded'],
      ['POST', '/api/archive/migration'],
      // A viewer path is not a prefix match.
      ['GET', '/api/accounts/a1/messages/42/raw/extra'],
      ['DELETE', '/api/exports'],
    ];
    for (const [method, path] of denied) {
      expect(viewerMayCall(method, path), `${method} ${path}`).toBe(false);
    }
  });
});

describe('API with a viewer login', () => {
  const settings = appSettingsSchema.parse({
    theme: 'dark',
    accentColor: 'violet',
    language: 'en',
    mcp: { enabled: true, httpEnabled: true, token: 'mcp-secret' },
  });
  const bundles = new EventEmitter();
  const stub = {
    isInitialized: true,
    isUnlocked: true,
    getSettings: () => settings,
    overview: () => [],
    scheduleInfo: () => ({ expression: '0 3 * * *', nextRun: null }),
    bundles,
  } as unknown as AmberChestApp;

  async function setup(): Promise<{
    call: (method: 'GET' | 'POST' | 'PATCH', url: string, token?: string) => Promise<{
      status: number;
      body: Record<string, unknown>;
    }>;
    viewer: string;
    admin: string;
    server: Awaited<ReturnType<typeof createServer>>;
  }> {
    const auth = AuthGuard.fromEnvironment({
      AMBERCHEST_UI_PASSWORD: 'admin-pw',
      AMBERCHEST_UI_PASSWORD_READONLY: 'viewer-pw',
    });
    const server = await createServer({ app: stub, auth });
    const call = async (method: 'GET' | 'POST' | 'PATCH', url: string, token?: string) => {
      const response = await server.inject({
        method,
        url,
        ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
        ...(method === 'GET' ? {} : { payload: {} }),
      });
      return { status: response.statusCode, body: response.json() as Record<string, unknown> };
    };
    return {
      call,
      viewer: auth.login('viewer-pw')?.token ?? '',
      admin: auth.login('admin-pw')?.token ?? '',
      server,
    };
  }

  it('answers the role on login and in the state', async () => {
    const { call, viewer } = await setup();
    const state = await call('GET', '/api/state', viewer);
    expect(state.body.role).toBe('viewer');
    expect(state.body.authenticated).toBe(true);
  });

  it('hides the settings, and with them the MCP token, from a viewer', async () => {
    const { call, viewer, admin } = await setup();

    const asViewer = await call('GET', '/api/state', viewer);
    expect(asViewer.body.settings).toBeNull();
    expect(asViewer.body.appearance).toEqual({ theme: 'dark', accentColor: 'violet', language: 'en' });
    expect(JSON.stringify(asViewer.body)).not.toContain('mcp-secret');

    const asAdmin = await call('GET', '/api/state', admin);
    expect(asAdmin.body.settings).not.toBeNull();
  });

  it('lets a viewer read, and refuses the rest with 403', async () => {
    const { call, viewer, admin } = await setup();

    expect((await call('GET', '/api/accounts', viewer)).status).toBe(200);
    expect((await call('GET', '/api/settings', viewer)).status).toBe(403);
    expect((await call('PATCH', '/api/settings', viewer)).status).toBe(403);
    expect((await call('POST', '/api/lock', viewer)).status).toBe(403);
    expect((await call('POST', '/api/unlock', viewer)).status).toBe(403);
    expect((await call('GET', '/api/logs', viewer)).status).toBe(403);

    // The same calls still work for an admin.
    expect((await call('GET', '/api/accounts', admin)).status).toBe(200);
    expect((await call('GET', '/api/settings', admin)).status).toBe(200);
  });

  it('rejects a request without a session', async () => {
    const { call } = await setup();
    expect((await call('GET', '/api/accounts')).status).toBe(401);
  });

  it('hands out the role with the token on login', async () => {
    const { server } = await setup();
    const response = await server.inject({
      method: 'POST',
      url: '/api/login',
      payload: { password: 'viewer-pw' },
    });
    const body = response.json() as { token: string; role: string };
    expect(response.statusCode).toBe(200);
    expect(body.role).toBe('viewer');
    expect(body.token.length).toBeGreaterThan(10);
  });

  it('cannot be talked past with a percent-encoded path', async () => {
    const { call, viewer } = await setup();
    // The router decodes these; the guard has to see what the router sees.
    for (const url of ['/%61pi/settings', '/%61pi/logs', '/api/%73ettings', '/%41pi/settings']) {
      const noToken = await call('GET', url);
      expect(noToken.status, `no token ${url}`).toBeGreaterThanOrEqual(401);
      expect(noToken.status, `no token ${url}`).not.toBe(200);
      const asViewer = await call('GET', url, viewer);
      expect(asViewer.status, `viewer ${url}`).not.toBe(200);
    }
    expect((await call('POST', '/%61pi/lock', viewer)).status).toBe(403);
  });

  it('may read the schedule, which the integration shows', async () => {
    const { call, viewer } = await setup();
    expect((await call('GET', '/api/schedule', viewer)).status).toBe(200);
  });

  it('treats HEAD like the GET it is served by', async () => {
    const { server, viewer } = await setup();
    const head = await server.inject({
      method: 'HEAD',
      url: '/api/accounts',
      headers: { authorization: `Bearer ${viewer}` },
    });
    expect(head.statusCode).toBe(200);
  });

  it('refuses setup to a viewer', async () => {
    const { call, viewer } = await setup();
    expect((await call('POST', '/api/setup', viewer)).status).toBe(403);
  });

  it('streams only export progress to a viewer', async () => {
    const { server, viewer } = await setup();
    await server.ready();
    const ticket = await server.inject({
      method: 'POST',
      url: '/api/tickets',
      headers: { authorization: `Bearer ${viewer}` },
      payload: { path: '/api/events' },
    });
    const socket = await server.injectWS(
      `/api/events?ticket=${(ticket.json() as { ticket: string }).ticket}`,
    );
    const received = new Promise<{ type: string; payload: unknown }>((resolve) => {
      socket.on('message', (data: Buffer) => resolve(JSON.parse(data.toString())));
    });
    // The handler subscribes after the handshake; give it a moment.
    await new Promise((resolve) => setTimeout(resolve, 100));
    bundles.emit('progress', { bundleId: 'b1', phase: 'done' });
    expect(await received).toEqual({ type: 'bundle-progress', payload: { bundleId: 'b1', phase: 'done' } });
    socket.terminate();
  });

  it('does not take a token from the URL any more', async () => {
    const { server, viewer, admin } = await setup();
    for (const token of [viewer, admin]) {
      const response = await server.inject({ method: 'GET', url: `/api/accounts?token=${token}` });
      expect(response.statusCode).toBe(401);
    }
  });

  it('serves a ticket once, for the path it was issued for', async () => {
    const { server, viewer } = await setup();
    const bearer = { authorization: `Bearer ${viewer}` };
    const issue = async (path: string) =>
      server.inject({ method: 'POST', url: '/api/tickets', headers: bearer, payload: { path } });

    const first = (await issue('/api/accounts')).json() as { ticket: string };
    const ok = await server.inject({ method: 'GET', url: `/api/accounts?ticket=${first.ticket}` });
    expect(ok.statusCode).toBe(200);
    const again = await server.inject({ method: 'GET', url: `/api/accounts?ticket=${first.ticket}` });
    expect(again.statusCode).toBe(401);

    // Issued for one path, useless on another.
    const other = (await issue('/api/accounts')).json() as { ticket: string };
    const wrong = await server.inject({ method: 'GET', url: `/api/schedule?ticket=${other.ticket}` });
    expect(wrong.statusCode).toBe(401);

    // And never for a method that is not GET.
    const post = (await issue('/api/exports')).json() as { ticket: string };
    const posted = await server.inject({
      method: 'POST',
      url: `/api/exports?ticket=${post.ticket}`,
      payload: {},
    });
    expect(posted.statusCode).toBe(401);
  });

  it('will not issue a viewer a ticket for what a viewer may not fetch', async () => {
    const { server, viewer, admin } = await setup();
    const ask = (token: string) =>
      server.inject({
        method: 'POST',
        url: '/api/tickets',
        headers: { authorization: `Bearer ${token}` },
        payload: { path: '/api/logs' },
      });
    expect((await ask(viewer)).statusCode).toBe(403);
    expect((await ask(admin)).statusCode).toBe(200);
    // Without a session there is nothing to issue it for.
    const anonymous = await server.inject({
      method: 'POST',
      url: '/api/tickets',
      payload: { path: '/api/accounts' },
    });
    expect(anonymous.statusCode).toBe(401);
  });

  it('sends the security headers, and keeps the API out of caches', async () => {
    const { server, admin } = await setup();
    const response = await server.inject({
      method: 'GET',
      url: '/api/accounts',
      headers: { authorization: `Bearer ${admin}` },
    });
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('can be allowed to sit in another site\'s frame', async () => {
    process.env.AMBERCHEST_ALLOW_FRAMING = 'true';
    try {
      const { server, admin } = await setup();
      const response = await server.inject({
        method: 'GET',
        url: '/api/accounts',
        headers: { authorization: `Bearer ${admin}` },
      });
      expect(response.headers['x-frame-options']).toBeUndefined();
      // The rest of the headers stay.
      expect(response.headers['x-content-type-options']).toBe('nosniff');
    } finally {
      delete process.env.AMBERCHEST_ALLOW_FRAMING;
    }
  });

  it('ends a viewer session on logout', async () => {
    const { call, viewer } = await setup();
    expect((await call('POST', '/api/logout', viewer)).status).toBe(200);
    expect((await call('GET', '/api/accounts', viewer)).status).toBe(401);
  });
});

import { describe, expect, it } from 'vitest';
import { appSettingsSchema, type AmberChestApp } from '@amberchest/core';
import { AuthGuard } from '../src/auth.js';
import { createServer } from '../src/index.js';

/**
 * The router decodes percent escapes before it matches a route. A guard that
 * looks at the raw URL sees `/%61pi/...`, decides it is not an API path, and
 * waves it through to the `/api/...` handler.
 */
describe('percent-encoded API paths', () => {
  const settings = appSettingsSchema.parse({
    mcp: { enabled: true, httpEnabled: true, token: 'mcp-secret' },
  });
  const stub = {
    isInitialized: true,
    isUnlocked: true,
    getSettings: () => settings,
    lock: () => undefined,
  } as unknown as AmberChestApp;

  async function server(): Promise<Awaited<ReturnType<typeof createServer>>> {
    return createServer({
      app: stub,
      auth: AuthGuard.fromEnvironment({ AMBERCHEST_UI_PASSWORD: 'ui-pw' }),
    });
  }

  it('asks for a token however the prefix is spelled', async () => {
    const s = await server();
    for (const url of ['/%61pi/settings', '/%61pi/logs', '/api/%73ettings']) {
      const response = await s.inject({ method: 'GET', url });
      expect(response.statusCode, url).toBe(401);
      expect(response.body, url).not.toContain('mcp-secret');
    }
  });

  it('still lets a valid token through the encoded path', async () => {
    const s = await server();
    const login = await s.inject({ method: 'POST', url: '/api/login', payload: { password: 'ui-pw' } });
    const { token } = login.json() as { token: string };
    const response = await s.inject({
      method: 'GET',
      url: '/%61pi/settings',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
  });

  it('rejects a path that cannot be decoded', async () => {
    const s = await server();
    const response = await s.inject({ method: 'GET', url: '/api/%E0%A4%A' });
    expect(response.statusCode).toBe(400);
  });
});

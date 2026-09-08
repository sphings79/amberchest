import { createServer, type Server } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfigStore } from '../src/config/store.js';
import { OAuthManager } from '../src/oauth/manager.js';

let server: Server | null = null;

afterEach(() => {
  server?.close();
  server = null;
});

/** A provider that hands out a new access token on every refresh. */
async function fakeProvider(): Promise<{ url: string; refreshes: () => number }> {
  let refreshes = 0;
  server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      const form = Object.fromEntries(new URLSearchParams(body));
      response.writeHead(200, { 'content-type': 'application/json' });
      if (form.grant_type === 'refresh_token') refreshes += 1;
      response.end(
        JSON.stringify({
          access_token: `access-${refreshes}`,
          expires_in: 3600,
          scope: 'mail',
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const port = (server!.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}`, refreshes: () => refreshes };
}

async function store(base: string): Promise<ConfigStore> {
  const config = new ConfigStore(join(base, 'config.enc'));
  await config.initialize('test-master-password');
  await config.unlock('test-master-password');
  return config;
}

describe('OAuthManager', () => {
  it('refreshes an expired token and remembers the new one', async () => {
    const provider = await fakeProvider();
    const config = await store(mkdtempSync(join(tmpdir(), 'ma-oauth-')));
    await config.updateSettings({
      oauth: {
        ...config.getSettings().oauth,
        custom: {
          ...config.getSettings().oauth.custom,
          clientId: 'client-1',
          tokenEndpoint: `${provider.url}/token`,
          authorizationEndpoint: `${provider.url}/auth`,
          scopes: ['mail'],
        },
      },
    });

    const account = await config.addAccount({
      name: 'Token',
      email: 'token@example.com',
      host: 'imap.example.com',
      port: 993,
      security: 'tls',
      rejectUnauthorized: true,
      username: 'token@example.com',
      authType: 'oauth',
      archivePath: null,
      oauth: {
        provider: 'custom',
        refreshToken: 'rt-1',
        accessToken: 'stale',
        // Yesterday, so the manager has to fetch a new one.
        expiresAt: Date.now() - 86_400_000,
        scope: 'mail',
      },
    });

    const manager = new OAuthManager(config);
    expect(await manager.accessToken(account)).toBe('access-1');
    expect(provider.refreshes()).toBe(1);

    // The new token is stored, so the next connection needs no round trip.
    const stored = config.getAccount(account.id);
    expect(stored?.oauth?.accessToken).toBe('access-1');
    expect(stored?.oauth?.refreshToken).toBe('rt-1');
    expect(await manager.accessToken(stored!)).toBe('access-1');
    expect(provider.refreshes()).toBe(1);
  });

  it('refuses to work without a client id', async () => {
    const config = await store(mkdtempSync(join(tmpdir(), 'ma-oauth-')));
    const manager = new OAuthManager(config);
    await expect(manager.startDevice('acc', 'microsoft')).rejects.toThrow(/client id/i);
  });

  it('says so when an account was never connected', async () => {
    const config = await store(mkdtempSync(join(tmpdir(), 'ma-oauth-')));
    const account = await config.addAccount({
      name: 'Plain',
      email: 'plain@example.com',
      host: 'imap.example.com',
      port: 993,
      security: 'tls',
      rejectUnauthorized: true,
      username: 'plain@example.com',
      archivePath: null,
    });
    const manager = new OAuthManager(config);
    await expect(manager.accessToken(account)).rejects.toThrow(/no OAuth connection/);
  });
});

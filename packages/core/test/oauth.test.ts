import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import {
  OAuthError,
  pollDeviceFlow,
  refreshTokens,
  startDeviceFlow,
} from '../src/oauth/device.js';
import { PROVIDERS, resolveProvider, supportsDeviceFlow } from '../src/oauth/providers.js';

let server: Server | null = null;

/** A provider that answers from a local server, with scripted replies. */
async function fakeProvider(replies: Record<string, unknown[]>) {
  const pending = new Map(Object.entries(replies).map(([path, list]) => [path, [...list]]));

  server = createServer((request, response) => {
    const path = request.url ?? '';
    const queue = pending.get(path) ?? [];
    const next = queue.shift() ?? { error: 'invalid_request' };
    const status = typeof next === 'object' && next && 'error' in next ? 400 : 200;
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(next));
  });

  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const port = (server!.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;

  return resolveProvider('custom', {
    name: 'Fake',
    deviceEndpoint: `${base}/device`,
    tokenEndpoint: `${base}/token`,
    scopes: ['mail'],
  });
}

afterEach(() => {
  server?.close();
  server = null;
});

describe('provider registry', () => {
  it('knows that Google has no device flow for mailboxes', () => {
    // Google's device flow is documented for sign in, Drive and YouTube only.
    expect(supportsDeviceFlow(PROVIDERS.google)).toBe(false);
    expect(PROVIDERS.google.scopes).toContain('https://mail.google.com/');
  });

  it('asks Microsoft for IMAP access and a refresh token', () => {
    expect(supportsDeviceFlow(PROVIDERS.microsoft)).toBe(true);
    expect(PROVIDERS.microsoft.scopes).toEqual([
      'https://outlook.office.com/IMAP.AccessAsUser.All',
      'offline_access',
    ]);
  });
});

describe('device flow', () => {
  it('returns the code the user has to type in', async () => {
    const provider = await fakeProvider({
      '/device': [
        {
          device_code: 'dev-1',
          user_code: 'ABCD-EFGH',
          verification_uri: 'https://example.test/device',
          verification_uri_complete: 'https://example.test/device?code=ABCD-EFGH',
          expires_in: 900,
          interval: 5,
        },
      ],
    });

    const code = await startDeviceFlow(provider, 'client-1');
    expect(code.userCode).toBe('ABCD-EFGH');
    expect(code.verificationUriComplete).toContain('ABCD-EFGH');
    expect(code.intervalSeconds).toBe(5);
    expect(code.expiresAt).toBeGreaterThan(Date.now());
  });

  it('treats a pending authorisation as "keep waiting"', async () => {
    const provider = await fakeProvider({
      '/token': [
        { error: 'authorization_pending', error_description: 'not yet' },
        { error: 'slow_down' },
        { access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600, scope: 'mail' },
      ],
    });

    expect(await pollDeviceFlow(provider, 'client-1', 'dev-1')).toBeNull();
    expect(await pollDeviceFlow(provider, 'client-1', 'dev-1')).toBeNull();

    const tokens = await pollDeviceFlow(provider, 'client-1', 'dev-1');
    expect(tokens?.accessToken).toBe('at-1');
    expect(tokens?.refreshToken).toBe('rt-1');
    // The expiry carries a minute of slack.
    expect(tokens!.expiresAt).toBeLessThan(Date.now() + 3600 * 1000);
  });

  it('gives up when the user says no', async () => {
    const provider = await fakeProvider({ '/token': [{ error: 'access_denied' }] });
    await expect(pollDeviceFlow(provider, 'client-1', 'dev-1')).rejects.toBeInstanceOf(OAuthError);
  });

  it('refuses a provider without a device endpoint', async () => {
    await expect(startDeviceFlow(PROVIDERS.google, 'client-1')).rejects.toThrow(/device flow/);
  });
});

describe('refresh', () => {
  it('keeps the old refresh token when the provider sends none', async () => {
    const provider = await fakeProvider({
      '/token': [{ access_token: 'at-2', expires_in: 3600 }],
    });

    const tokens = await refreshTokens(provider, 'client-1', 'rt-old');
    expect(tokens.accessToken).toBe('at-2');
    expect(tokens.refreshToken).toBe('rt-old');
  });

  it('takes the new one when the provider rotates it', async () => {
    const provider = await fakeProvider({
      '/token': [{ access_token: 'at-3', refresh_token: 'rt-new', expires_in: 3600 }],
    });

    const tokens = await refreshTokens(provider, 'client-1', 'rt-old');
    expect(tokens.refreshToken).toBe('rt-new');
  });

  it('reports a refresh token that was withdrawn', async () => {
    const provider = await fakeProvider({ '/token': [{ error: 'invalid_grant' }] });
    await expect(refreshTokens(provider, 'client-1', 'rt-old')).rejects.toMatchObject({
      code: 'invalid_grant',
    });
  });
});

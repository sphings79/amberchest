import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { buildAuthorization, codeFromInput, exchangeCode } from '../src/oauth/code.js';
import { OAuthError } from '../src/oauth/device.js';
import { PROVIDERS, resolveProvider } from '../src/oauth/providers.js';

let server: Server | null = null;

afterEach(() => {
  server?.close();
  server = null;
});

describe('buildAuthorization', () => {
  it('asks for a refresh token and protects the exchange with PKCE', () => {
    const pending = buildAuthorization(PROVIDERS.google, 'client-1', 'http://127.0.0.1:49500');
    const url = new URL(pending.url);

    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('scope')).toBe('https://mail.google.com/');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('state')).toBe(pending.state);
    // The verifier stays here; only its hash travels.
    expect(pending.url).not.toContain(pending.verifier);
  });

  it('preselects the mailbox it is meant for', () => {
    const pending = buildAuthorization(PROVIDERS.google, 'client-1', 'http://127.0.0.1:1', {
      loginHint: 'zweites.konto@gmail.com',
    });
    expect(new URL(pending.url).searchParams.get('login_hint')).toBe('zweites.konto@gmail.com');
  });

  it('gives every attempt its own state and verifier', () => {
    const first = buildAuthorization(PROVIDERS.google, 'c', 'http://127.0.0.1:1');
    const second = buildAuthorization(PROVIDERS.google, 'c', 'http://127.0.0.1:1');
    expect(first.state).not.toBe(second.state);
    expect(first.verifier).not.toBe(second.verifier);
  });
});

describe('codeFromInput', () => {
  it('takes a bare code', () => {
    expect(codeFromInput('  4/abc123 ')).toEqual({ code: '4/abc123', state: null });
  });

  it('takes the whole address the browser ended up on', () => {
    const parsed = codeFromInput('http://127.0.0.1:49500/?state=st-1&code=4/abc123&scope=mail');
    expect(parsed).toEqual({ code: '4/abc123', state: 'st-1' });
  });

  it('reports what the provider complained about', () => {
    expect(() =>
      codeFromInput('http://127.0.0.1:49500/?error=access_denied&error_description=Nope'),
    ).toThrow(/Nope/);
  });

  it('says so when an address carries no code at all', () => {
    expect(() => codeFromInput('http://127.0.0.1:49500/')).toThrow(/no code/);
    expect(() => codeFromInput('   ')).toThrow(OAuthError);
  });
});

describe('exchangeCode', () => {
  async function fakeToken(reply: unknown, status = 200) {
    const seen: Record<string, string>[] = [];
    server = createServer((request, response) => {
      let body = '';
      request.on('data', (chunk) => (body += chunk));
      request.on('end', () => {
        seen.push(Object.fromEntries(new URLSearchParams(body)));
        response.writeHead(status, { 'content-type': 'application/json' });
        response.end(JSON.stringify(reply));
      });
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const port = (server!.address() as { port: number }).port;
    return {
      provider: resolveProvider('custom', {
        tokenEndpoint: `http://127.0.0.1:${port}/token`,
        authorizationEndpoint: 'https://example.test/auth',
        scopes: ['mail'],
      }),
      seen,
    };
  }

  it('sends the verifier and the same redirect address as before', async () => {
    const { provider, seen } = await fakeToken({
      access_token: 'at-1',
      refresh_token: 'rt-1',
      expires_in: 3600,
    });
    const pending = buildAuthorization(provider, 'client-1', 'http://127.0.0.1:49500');

    const tokens = await exchangeCode(provider, 'client-1', pending, 'the-code');
    expect(tokens.refreshToken).toBe('rt-1');
    expect(seen[0]).toMatchObject({
      grant_type: 'authorization_code',
      code: 'the-code',
      redirect_uri: 'http://127.0.0.1:49500',
      code_verifier: pending.verifier,
    });
  });

  it("passes the provider's complaint on", async () => {
    const { provider } = await fakeToken({ error: 'invalid_grant', error_description: 'Used' }, 400);
    const pending = buildAuthorization(provider, 'client-1', 'http://127.0.0.1:49500');
    await expect(exchangeCode(provider, 'client-1', pending, 'old')).rejects.toMatchObject({
      code: 'invalid_grant',
    });
  });
});

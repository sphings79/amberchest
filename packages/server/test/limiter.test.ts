import { describe, expect, it } from 'vitest';
import type { AmberChestApp } from '@amberchest/core';
import { AuthGuard } from '../src/auth.js';
import { createServer } from '../src/index.js';
import { LoginLimiter } from '../src/login-limiter.js';
import { DEFAULT_TRUSTED_PROXIES, trustProxyFromEnvironment } from '../src/trust-proxy.js';

function clocked(options: ConstructorParameters<typeof LoginLimiter>[0] = {}): {
  limiter: LoginLimiter;
  advance: (ms: number) => void;
} {
  let clock = 0;
  return {
    limiter: new LoginLimiter({ ...options, now: () => clock }),
    advance: (ms) => void (clock += ms),
  };
}

const MINUTE = 60 * 1000;

describe('LoginLimiter', () => {
  it('locks an address after five wrong tries, for fifteen minutes', () => {
    const { limiter, advance } = clocked();
    for (let i = 0; i < 4; i += 1) {
      expect(limiter.recordFailure('a')).toBe(false);
      expect(limiter.check('a').allowed).toBe(true);
    }
    expect(limiter.recordFailure('a')).toBe(true);

    const verdict = limiter.check('a');
    expect(verdict.allowed).toBe(false);
    expect(verdict).toMatchObject({ retryAfterSeconds: 15 * 60 });

    advance(15 * MINUTE + 1);
    expect(limiter.check('a').allowed).toBe(true);
  });

  it('leaves other addresses alone', () => {
    const { limiter } = clocked();
    for (let i = 0; i < 5; i += 1) limiter.recordFailure('a');
    expect(limiter.check('a').allowed).toBe(false);
    expect(limiter.check('b').allowed).toBe(true);
  });

  it('locks for twice as long when the same address comes back and does it again', () => {
    const { limiter, advance } = clocked();
    for (let i = 0; i < 5; i += 1) limiter.recordFailure('a');
    advance(15 * MINUTE + 1);
    for (let i = 0; i < 5; i += 1) limiter.recordFailure('a');
    expect(limiter.check('a')).toMatchObject({ allowed: false, retryAfterSeconds: 30 * 60 });
  });

  it('forgets the strikes after a quiet day', () => {
    const { limiter, advance } = clocked();
    for (let i = 0; i < 5; i += 1) limiter.recordFailure('a');
    advance(25 * 60 * MINUTE);
    for (let i = 0; i < 5; i += 1) limiter.recordFailure('a');
    expect(limiter.check('a')).toMatchObject({ allowed: false, retryAfterSeconds: 15 * 60 });
  });

  it('counts a correct password as a fresh start', () => {
    const { limiter } = clocked();
    for (let i = 0; i < 4; i += 1) limiter.recordFailure('a');
    limiter.recordSuccess('a');
    expect(limiter.recordFailure('a')).toBe(false);
  });

  it('slows everybody down when failures arrive from many addresses', () => {
    const { limiter, advance } = clocked({ globalPerMinute: 10 });
    for (let i = 0; i < 10; i += 1) limiter.recordFailure(`ip-${i}`);
    expect(limiter.check('someone-new').allowed).toBe(false);
    advance(MINUTE + 1);
    expect(limiter.check('someone-new').allowed).toBe(true);
  });

  it('remembers a bounded number of addresses', () => {
    const { limiter } = clocked({ maxEntries: 3, maxFailures: 1 });
    for (let i = 0; i < 10; i += 1) limiter.recordFailure(`ip-${i}`);
    // The oldest were dropped, so they are no longer locked.
    expect(limiter.check('ip-0').allowed).toBe(true);
    expect(limiter.check('ip-9').allowed).toBe(false);
  });
});

describe('trustProxyFromEnvironment', () => {
  it('trusts private networks unless told otherwise', () => {
    expect(trustProxyFromEnvironment(undefined)).toEqual(DEFAULT_TRUSTED_PROXIES);
    expect(trustProxyFromEnvironment('  ')).toEqual(DEFAULT_TRUSTED_PROXIES);
  });

  it('understands none, a list and a hop count', () => {
    expect(trustProxyFromEnvironment('none')).toBe(false);
    expect(trustProxyFromEnvironment('10.0.0.0/8, 192.168.1.5')).toEqual(['10.0.0.0/8', '192.168.1.5']);
    const hops = trustProxyFromEnvironment('1');
    expect(typeof hops).toBe('function');
    if (typeof hops === 'function') {
      expect(hops('10.0.0.1', 0)).toBe(true);
      expect(hops('10.0.0.1', 1)).toBe(false);
    }
  });
});

describe('login limit over HTTP', () => {
  const stub = { isInitialized: true, isUnlocked: true } as unknown as AmberChestApp;

  async function server(): Promise<Awaited<ReturnType<typeof createServer>>> {
    return createServer({
      app: stub,
      auth: AuthGuard.fromEnvironment({ AMBERCHEST_UI_PASSWORD: 'admin-pw' }),
    });
  }

  const login = (
    s: Awaited<ReturnType<typeof createServer>>,
    password: string,
    remoteAddress: string,
    headers: Record<string, string> = {},
  ) =>
    s.inject({
      method: 'POST',
      url: '/api/login',
      payload: { password },
      remoteAddress,
      headers,
    });

  it('answers 429 with Retry-After once an address is locked, even to the right password', async () => {
    const s = await server();
    for (let i = 0; i < 5; i += 1) {
      expect((await login(s, 'wrong', '10.1.1.1')).statusCode).toBe(401);
    }
    const locked = await login(s, 'admin-pw', '10.1.1.1');
    expect(locked.statusCode).toBe(429);
    expect(Number(locked.headers['retry-after'])).toBeGreaterThan(0);

    // Somebody else is not affected.
    expect((await login(s, 'admin-pw', '10.1.1.2')).statusCode).toBe(200);
  });

  it('cannot be dodged by changing X-Forwarded-For from the open internet', async () => {
    const s = await server();
    for (let i = 0; i < 5; i += 1) {
      const response = await login(s, 'wrong', '203.0.113.9', { 'x-forwarded-for': `1.2.3.${i}` });
      expect(response.statusCode).toBe(401);
    }
    const next = await login(s, 'admin-pw', '203.0.113.9', { 'x-forwarded-for': '9.9.9.9' });
    expect(next.statusCode).toBe(429);
  });

  it('tells clients apart by the forwarded address behind a proxy of ours', async () => {
    const s = await server();
    for (let i = 0; i < 5; i += 1) {
      await login(s, 'wrong', '172.18.0.2', { 'x-forwarded-for': '198.51.100.7' });
    }
    expect(
      (await login(s, 'admin-pw', '172.18.0.2', { 'x-forwarded-for': '198.51.100.7' })).statusCode,
    ).toBe(429);
    expect(
      (await login(s, 'admin-pw', '172.18.0.2', { 'x-forwarded-for': '198.51.100.8' })).statusCode,
    ).toBe(200);
  });
});

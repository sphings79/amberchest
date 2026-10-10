import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The parts of the API client that decide how a credential reaches the
 * server: the token in a header, a one-time ticket for what a browser has to
 * fetch by itself, and the fallback for a server that has no tickets.
 *
 * The module reads the page's location and storage when it is loaded, so each
 * test stubs those and imports it afresh.
 */
function storage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, value),
  };
}

interface Page {
  href: string;
}

function stubBrowser(page: Page): { replaceState: ReturnType<typeof vi.fn>; session: Storage } {
  const replaceState = vi.fn((_state: unknown, _title: string, url: string) => {
    page.href = new URL(url, page.href).toString();
  });
  const session = storage();
  vi.stubGlobal('sessionStorage', session);
  vi.stubGlobal('localStorage', storage());
  vi.stubGlobal('window', {
    get location() {
      const url = new URL(page.href);
      return { href: url.href, search: url.search, hash: url.hash, origin: url.origin };
    },
    history: { replaceState },
  });
  return { replaceState, session };
}

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function load(): Promise<typeof import('../src/api/client.js')> {
  vi.resetModules();
  return import('../src/api/client.js');
}

describe('API client credentials', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('the token handed over at start', () => {
    it('is taken from the fragment, and the fragment is removed', async () => {
      const page = { href: 'http://127.0.0.1:8484/?desktop=1#token=abc123' };
      const { replaceState, session } = stubBrowser(page);

      const client = await load();
      expect(client.getToken()).toBe('abc123');
      expect(session.getItem('amberchest-token')).toBe('abc123');
      expect(replaceState).toHaveBeenCalled();
      expect(page.href).not.toContain('abc123');
      expect(page.href).not.toContain('desktop');
    });

    it('is not taken from the query string any more', async () => {
      stubBrowser({ href: 'http://127.0.0.1:8484/?token=sneaky' });
      const client = await load();
      expect(client.getToken()).toBeNull();
    });

    it('is remembered for the session', async () => {
      const { session } = stubBrowser({ href: 'http://127.0.0.1:8484/' });
      session.setItem('amberchest-token', 'kept');
      const client = await load();
      expect(client.getToken()).toBe('kept');
    });
  });

  describe('downloadUrl', () => {
    it('asks for a ticket and puts only that in the address', async () => {
      stubBrowser({ href: 'http://127.0.0.1:8484/' });
      const client = await load();
      client.setToken('secret-token');
      fetchMock.mockResolvedValueOnce(reply(200, { ticket: 'one-time' }));

      const url = await client.downloadUrl('/accounts/a1/messages/7/raw');

      expect(url).toBe('api/accounts/a1/messages/7/raw?ticket=one-time');
      expect(url).not.toContain('secret-token');

      const [target, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(target).toBe('api/tickets');
      expect(init.method).toBe('POST');
      expect(JSON.parse(String(init.body))).toEqual({ path: '/api/accounts/a1/messages/7/raw' });
      expect(new Headers(init.headers).get('authorization')).toBe('Bearer secret-token');
    });

    it('leaves a query string out of the ticket path and keeps it in the link', async () => {
      stubBrowser({ href: 'http://127.0.0.1:8484/' });
      const client = await load();
      client.setToken('t');
      fetchMock.mockResolvedValueOnce(reply(200, { ticket: 'k' }));

      const url = await client.downloadUrl('/exports/b1/download?x=1');

      expect(url).toBe('api/exports/b1/download?x=1&ticket=k');
      const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
      expect(JSON.parse(String(init.body))).toEqual({ path: '/api/exports/b1/download' });
    });

    it('needs nothing on an instance without a password', async () => {
      stubBrowser({ href: 'http://127.0.0.1:8484/' });
      const client = await load();

      expect(await client.downloadUrl('/accounts/a1/messages/7/raw')).toBe(
        'api/accounts/a1/messages/7/raw',
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('falls back to the token for a server that has no tickets, and remembers it', async () => {
      stubBrowser({ href: 'http://127.0.0.1:8484/' });
      const client = await load();
      client.setToken('legacy-token');
      fetchMock.mockResolvedValueOnce(reply(404, { error: 'Not found' }));

      const first = await client.downloadUrl('/accounts/a1/messages/7/raw');
      const second = await client.downloadUrl('/accounts/a1/messages/8/raw');

      expect(first).toBe('api/accounts/a1/messages/7/raw?token=legacy-token');
      expect(second).toBe('api/accounts/a1/messages/8/raw?token=legacy-token');
      // Asked once; after that the server is known to be old.
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('does not fall back on any other failure', async () => {
      stubBrowser({ href: 'http://127.0.0.1:8484/' });
      const client = await load();
      client.setToken('t');

      for (const status of [401, 403, 500]) {
        fetchMock.mockResolvedValueOnce(reply(status, { error: 'no' }));
        await expect(client.downloadUrl('/accounts/a1/messages/7/raw')).rejects.toMatchObject({
          status,
        });
      }
    });
  });

  describe('eventsUrl', () => {
    it('is a websocket address carrying a ticket', async () => {
      stubBrowser({ href: 'http://127.0.0.1:8484/' });
      const client = await load();
      client.setToken('secret-token');
      fetchMock.mockResolvedValueOnce(reply(200, { ticket: 'sock' }));

      const url = new URL(await client.eventsUrl());

      expect(url.protocol).toBe('ws:');
      expect(url.pathname).toBe('/api/events');
      expect(url.searchParams.get('ticket')).toBe('sock');
      expect(url.search).not.toContain('secret-token');
    });

    it('asks again every time, because a ticket is spent', async () => {
      stubBrowser({ href: 'http://127.0.0.1:8484/' });
      const client = await load();
      client.setToken('t');
      fetchMock
        .mockResolvedValueOnce(reply(200, { ticket: 'first' }))
        .mockResolvedValueOnce(reply(200, { ticket: 'second' }));

      const a = new URL(await client.eventsUrl());
      const b = new URL(await client.eventsUrl());

      expect(a.searchParams.get('ticket')).toBe('first');
      expect(b.searchParams.get('ticket')).toBe('second');
    });

    it('uses the token against an old server', async () => {
      stubBrowser({ href: 'http://127.0.0.1:8484/' });
      const client = await load();
      client.setToken('legacy-token');
      fetchMock.mockResolvedValueOnce(reply(404, { error: 'Not found' }));

      const url = new URL(await client.eventsUrl());
      expect(url.searchParams.get('token')).toBe('legacy-token');
      expect(url.searchParams.has('ticket')).toBe(false);
    });
  });
});

import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { appSettingsSchema, type AmberChestApp } from '@amberchest/core';
import { AuthGuard } from '../src/auth.js';
import { createServer } from '../src/index.js';

describe('bulk discard and restore routes', () => {
  const settings = appSettingsSchema.parse({});

  async function setup() {
    const app = {
      isInitialized: true,
      isUnlocked: true,
      getSettings: () => settings,
      overview: () => [],
      bundles: new EventEmitter(),
      ownAddresses: vi.fn(() => ['me@example.com']),
      discardMessages: vi.fn(async () => ({ done: 2, failed: 0, handedOver: 0 })),
      discardMatching: vi.fn(async () => ({ done: 500, failed: 0, handedOver: 0, remaining: 40 })),
      undiscardMessages: vi.fn(async () => ({ done: 1, failed: 0 })),
      undiscardMatching: vi.fn(async () => ({ done: 5, failed: 0, remaining: 0 })),
    };
    const auth = AuthGuard.fromEnvironment({
      AMBERCHEST_UI_PASSWORD: 'admin-pw',
      AMBERCHEST_UI_PASSWORD_READONLY: 'viewer-pw',
    });
    const server = await createServer({ app: app as unknown as AmberChestApp, auth });
    const post = (url: string, payload: unknown, token: string) =>
      server.inject({
        method: 'POST',
        url,
        payload: payload as object,
        headers: { authorization: `Bearer ${token}` },
      });
    return {
      app,
      post,
      admin: auth.login('admin-pw')?.token ?? '',
      viewer: auth.login('viewer-pw')?.token ?? '',
    };
  }

  it('discards a list of messages', async () => {
    const { app, post, admin } = await setup();
    const messages = [
      { accountId: 'a1', messageId: 1 },
      { accountId: 'a1', messageId: 2 },
    ];
    const response = await post('/api/messages/discard', { messages }, admin);
    expect(response.statusCode).toBe(200);
    // All places of a mail stored once, unless the caller says otherwise.
    expect(app.discardMessages).toHaveBeenCalledWith(messages, { allLocations: true });

    await post('/api/messages/discard', { messages, allLocations: false }, admin);
    expect(app.discardMessages).toHaveBeenLastCalledWith(messages, { allLocations: false });
    expect(response.json()).toMatchObject({ done: 2 });
  });

  it('hands a filter to the search as options, in batches', async () => {
    const { app, post, admin } = await setup();
    const response = await post(
      '/api/messages/discard',
      { filter: { q: 'newsletter', account: 'a1', folders: ['INBOX'], toSelf: true }, limit: 200 },
      admin,
    );
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ remaining: 40 });

    const [options, limit] = app.discardMatching.mock.calls[0] as unknown as [
      Record<string, unknown>,
      number,
    ];
    expect(limit).toBe(200);
    expect(app.discardMatching.mock.calls[0]![2]).toEqual({ allLocations: true });
    expect(options).toMatchObject({
      query: 'newsletter',
      accountId: 'a1',
      folders: ['INBOX'],
      sentToSelf: ['me@example.com'],
      includeDeleted: false,
    });
  });

  it('refuses an empty list and an oversized batch', async () => {
    const { post, admin } = await setup();
    expect((await post('/api/messages/discard', { messages: [] }, admin)).statusCode).toBe(400);
    expect((await post('/api/messages/discard', { filter: { q: '' }, limit: 5000 }, admin)).statusCode).toBe(
      400,
    );
    expect((await post('/api/messages/discard', {}, admin)).statusCode).toBe(400);
  });

  it('takes decisions back by list and by filter', async () => {
    const { app, post, admin } = await setup();
    const byList = await post('/api/discarded/restore', { messages: [{ accountId: 'a1', messageId: 9 }] }, admin);
    expect(byList.statusCode).toBe(200);
    expect(app.undiscardMessages).toHaveBeenCalled();

    const byFilter = await post('/api/discarded/restore', { filter: { account: 'a1', folder: 'INBOX', q: 'x' } }, admin);
    expect(byFilter.statusCode).toBe(200);
    expect(app.undiscardMatching).toHaveBeenCalledWith(
      { accountId: 'a1', folderPath: 'INBOX', search: 'x' },
      500,
    );
  });

  it('keeps a read-only login out', async () => {
    const { app, post, viewer } = await setup();
    const discard = await post('/api/messages/discard', { messages: [{ accountId: 'a1', messageId: 1 }] }, viewer);
    const restore = await post('/api/discarded/restore', { messages: [{ accountId: 'a1', messageId: 1 }] }, viewer);
    expect(discard.statusCode).toBe(403);
    expect(restore.statusCode).toBe(403);
    expect(app.discardMessages).not.toHaveBeenCalled();
    expect(app.undiscardMessages).not.toHaveBeenCalled();
  });
});

import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { appSettingsSchema, type AmberChestApp } from '@amberchest/core';
import { AuthGuard } from '../src/auth.js';
import { createServer } from '../src/index.js';

describe('removing mail from the server', () => {
  async function setup(allowServerRemoval: boolean) {
    const app = {
      isInitialized: true,
      isUnlocked: true,
      getSettings: () => appSettingsSchema.parse({}),
      overview: () => [],
      bundles: new EventEmitter(),
      requireAccount: () => ({ id: 'a1', name: 'Mein Konto', settings: { allowServerRemoval } }),
      removal: { isRunning: () => false },
      startServerRemoval: vi.fn(async () => ({ phase: 'done' })),
      planServerRemoval: vi.fn(() => ({ messages: 3, bytes: 30, noChecksum: 0, folders: [] })),
    };
    const auth = AuthGuard.fromEnvironment({
      AMBERCHEST_UI_PASSWORD: 'admin-pw',
      AMBERCHEST_UI_PASSWORD_READONLY: 'viewer-pw',
    });
    const server = await createServer({ app: app as unknown as AmberChestApp, auth });
    const post = (url: string, payload: object, token: string) =>
      server.inject({ method: 'POST', url, payload, headers: { authorization: `Bearer ${token}` } });
    return {
      app,
      post,
      admin: auth.login('admin-pw')?.token ?? '',
      viewer: auth.login('viewer-pw')?.token ?? '',
    };
  }

  it('refuses while the account has not allowed it', async () => {
    const { app, post, admin } = await setup(false);
    const response = await post('/api/accounts/a1/removal', { confirmName: 'Mein Konto' }, admin);
    expect(response.statusCode).toBe(403);
    expect(app.startServerRemoval).not.toHaveBeenCalled();
  });

  it('wants the account name typed exactly', async () => {
    const { app, post, admin } = await setup(true);
    for (const confirmName of ['', 'mein konto', 'Mein Konto ']) {
      const response = await post('/api/accounts/a1/removal', { confirmName }, admin);
      expect(response.statusCode, confirmName).toBe(400);
    }
    expect(app.startServerRemoval).not.toHaveBeenCalled();
  });

  it('starts with the right name', async () => {
    const { app, post, admin } = await setup(true);
    const response = await post(
      '/api/accounts/a1/removal',
      { confirmName: 'Mein Konto', folders: ['INBOX'], olderThanDays: 30 },
      admin,
    );
    expect(response.statusCode).toBe(200);
    expect(app.startServerRemoval).toHaveBeenCalledWith('a1', { folders: ['INBOX'], olderThanDays: 30 });
  });

  it('keeps a read-only login out of the plan and the deletion', async () => {
    const { app, post, viewer } = await setup(true);
    expect((await post('/api/accounts/a1/removal/plan', {}, viewer)).statusCode).toBe(403);
    expect(
      (await post('/api/accounts/a1/removal', { confirmName: 'Mein Konto' }, viewer)).statusCode,
    ).toBe(403);
    expect(app.startServerRemoval).not.toHaveBeenCalled();
  });
});

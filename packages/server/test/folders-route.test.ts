import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { appSettingsSchema, type AmberChestApp } from '@amberchest/core';
import { AuthGuard } from '../src/auth.js';
import { createServer } from '../src/index.js';

describe('the folder list from the server', () => {
  async function ask(failure: Error) {
    const app = {
      isInitialized: true,
      isUnlocked: true,
      getSettings: () => appSettingsSchema.parse({}),
      overview: () => [],
      bundles: new EventEmitter(),
      getFolderTree: async () => {
        throw failure;
      },
    };
    const auth = AuthGuard.fromEnvironment({ AMBERCHEST_UI_PASSWORD: 'admin-pw' });
    const server = await createServer({ app: app as unknown as AmberChestApp, auth });
    return server.inject({
      method: 'GET',
      url: '/api/accounts/a1/folders',
      headers: { authorization: `Bearer ${auth.login('admin-pw')?.token ?? ''}` },
    });
  }

  it('names a common failure with a code the interface can word itself', async () => {
    const response = await ask(Object.assign(new Error('getaddrinfo'), { code: 'ENOTFOUND' }));
    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({
      error: 'Server not found - check the host name',
      errorCode: 'not-found',
    });
  });

  it('sends only the text for any other failure', async () => {
    const response = await ask(new Error('something odd'));
    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({ error: 'something odd' });
  });
});

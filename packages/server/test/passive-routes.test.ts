import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { AccountPassiveError, appSettingsSchema, type AmberChestApp } from '@amberchest/core';
import { AuthGuard } from '../src/auth.js';
import { createServer } from '../src/index.js';

describe('passive accounts over HTTP', () => {
  async function setup(passive: boolean, warning: object | null = null) {
    const account = { id: 'a1', name: 'Old mailbox', passive, settings: { allowServerRemoval: true } };
    const app = {
      isInitialized: true,
      isUnlocked: true,
      getSettings: () => appSettingsSchema.parse({}),
      overview: () => [],
      bundles: new EventEmitter(),
      requireAccount: () => account,
      connectionFor: vi.fn(async () => ({ host: 'imap.example.invalid' })),
      testConnection: vi.fn(async () => ({ ok: true })),
      sync: { isRunning: () => false },
      verify: { isRunning: () => false },
      removal: { isRunning: () => false },
      startSyncAndIndex: vi.fn(async () => undefined),
      startVerify: vi.fn(async () => ({ phase: 'done' })),
      startServerRemoval: vi.fn(async () => ({ phase: 'done' })),
      getFolderTree: vi.fn(async () => {
        throw new AccountPassiveError(account.name);
      }),
      passiveCheck: vi.fn(() => warning),
      setAccountPassive: vi.fn(async (_id: string, value: boolean, options: { force?: boolean } = {}) => {
        if (value && warning && !options.force) return { account, warning, changed: false };
        return { account: { ...account, passive: value }, warning: null, changed: account.passive !== value };
      }),
      retireAfterSync: vi.fn(async () => true),
    };
    const auth = AuthGuard.fromEnvironment({
      AMBERCHEST_UI_PASSWORD: 'admin-pw',
      AMBERCHEST_UI_PASSWORD_READONLY: 'viewer-pw',
    });
    const server = await createServer({ app: app as unknown as AmberChestApp, auth });
    const call = (method: 'GET' | 'POST', url: string, token: string, payload?: object) =>
      server.inject({ method, url, ...(payload ? { payload } : {}), headers: { authorization: `Bearer ${token}` } });
    return {
      app,
      call,
      admin: auth.login('admin-pw')?.token ?? '',
      viewer: auth.login('viewer-pw')?.token ?? '',
    };
  }

  it('turns a manual backup away with a code the interface can act on', async () => {
    const { app, call, admin } = await setup(true);
    const response = await call('POST', '/api/accounts/a1/sync', admin);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'ACCOUNT_PASSIVE' });
    expect(app.startSyncAndIndex).not.toHaveBeenCalled();
  });

  it('still starts a backup for an active account', async () => {
    const { app, call, admin } = await setup(false);
    expect((await call('POST', '/api/accounts/a1/sync', admin)).statusCode).toBe(200);
    expect(app.startSyncAndIndex).toHaveBeenCalledWith('a1');
  });

  it('refuses the folder list from the server', async () => {
    const { call, admin } = await setup(true);
    const response = await call('GET', '/api/accounts/a1/folders', admin);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'ACCOUNT_PASSIVE' });
  });

  it('allows the local check but not the one against the server', async () => {
    const { app, call, admin } = await setup(true);
    expect((await call('POST', '/api/accounts/a1/verify', admin, { checkServer: false })).statusCode).toBe(200);
    expect(app.startVerify).toHaveBeenCalledTimes(1);

    const refused = await call('POST', '/api/accounts/a1/verify', admin, { checkServer: true });
    expect(refused.statusCode).toBe(409);
    expect(app.startVerify).toHaveBeenCalledTimes(1);
  });

  it('refuses removal from the server even when the account allows it', async () => {
    const { app, call, admin } = await setup(true);
    const response = await call('POST', '/api/accounts/a1/removal', admin, { confirmName: 'Old mailbox' });
    expect(response.statusCode).toBe(409);
    expect(app.startServerRemoval).not.toHaveBeenCalled();
  });

  it('reports the warning before switching, and changes nothing', async () => {
    const warning = { reason: 'never' };
    const { app, call, admin } = await setup(false, warning);
    expect((await call('GET', '/api/accounts/a1/passive', admin)).json()).toMatchObject({ warning });

    const response = await call('POST', '/api/accounts/a1/passive', admin, { passive: true });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ warning });
    expect(app.setAccountPassive).toHaveBeenCalledWith('a1', true, { force: false });
  });

  it('switches anyway when forced', async () => {
    const { app, call, admin } = await setup(false, { reason: 'never' });
    const response = await call('POST', '/api/accounts/a1/passive', admin, { passive: true, force: true });
    expect(response.statusCode).toBe(200);
    expect(app.setAccountPassive).toHaveBeenCalledWith('a1', true, { force: true });
  });

  it('runs a final backup first on request', async () => {
    const { app, call, admin } = await setup(false);
    const response = await call('POST', '/api/accounts/a1/passive', admin, { passive: true, afterSync: true });
    expect(response.json()).toEqual({ started: true });
    expect(app.retireAfterSync).toHaveBeenCalledWith('a1');
    expect(app.setAccountPassive).not.toHaveBeenCalled();
  });

  it('answers with a connection test when an account goes active again', async () => {
    const { app, call, admin } = await setup(true);
    const response = await call('POST', '/api/accounts/a1/passive', admin, { passive: false });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ test: { ok: true } });
    expect(app.testConnection).toHaveBeenCalledTimes(1);
  });

  it('keeps a read-only login out', async () => {
    const { app, call, viewer } = await setup(false);
    const response = await call('POST', '/api/accounts/a1/passive', viewer, { passive: true, force: true });
    expect(response.statusCode).toBe(403);
    expect(app.setAccountPassive).not.toHaveBeenCalled();
  });
});

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import { appSettingsSchema, logger, type AmberChestApp } from '@amberchest/core';
import { AuthGuard } from '../src/auth.js';
import { createServer } from '../src/index.js';

describe('the log file download', () => {
  afterEach(() => logger.setFile(null));

  async function setup() {
    const app = {
      isInitialized: true,
      isUnlocked: true,
      getSettings: () => appSettingsSchema.parse({}),
      overview: () => [],
      bundles: new EventEmitter(),
    };
    const auth = AuthGuard.fromEnvironment({
      AMBERCHEST_UI_PASSWORD: 'admin-pw',
      AMBERCHEST_UI_PASSWORD_READONLY: 'viewer-pw',
    });
    const server = await createServer({ app: app as unknown as AmberChestApp, auth });
    const get = (token: string) =>
      server.inject({ method: 'GET', url: '/api/logs/file', headers: { authorization: `Bearer ${token}` } });
    return { get, admin: auth.login('admin-pw')?.token ?? '', viewer: auth.login('viewer-pw')?.token ?? '' };
  }

  it('is a 404 while no file is written', async () => {
    const { get, admin } = await setup();
    expect((await get(admin)).statusCode).toBe(404);
  });

  it('hands the file to an administrator', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'ac-logroute-')), 'a.log');
    writeFileSync(path, 'a line\n');
    logger.setFile(path);
    const { get, admin } = await setup();

    const response = await get(admin);
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('a line\n');
    expect(response.headers['content-disposition']).toContain('amberchest.log');
  });

  it('is closed to the read-only login', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'ac-logroute-')), 'a.log');
    writeFileSync(path, 'a line\n');
    logger.setFile(path);
    const { get, viewer } = await setup();
    expect((await get(viewer)).statusCode).toBe(403);
  });
});

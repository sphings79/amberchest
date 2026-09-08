import { mkdtempSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decryptJson, deriveKey, encryptJson, newSalt, WrongPasswordError } from '../src/config/crypto.js';
import { ConfigStore } from '../src/config/store.js';

describe('envelope encryption', () => {
  it('round trips a value', async () => {
    const salt = newSalt();
    const key = await deriveKey('correct horse', salt);
    const envelope = encryptJson({ secret: 'value' }, key, salt);
    expect(decryptJson<{ secret: string }>(envelope, key).secret).toBe('value');
  });

  it('rejects a wrong password', async () => {
    const salt = newSalt();
    const envelope = encryptJson({ secret: 'value' }, await deriveKey('right', salt), salt);
    const wrongKey = await deriveKey('wrong', salt);
    expect(() => decryptJson(envelope, wrongKey)).toThrow(WrongPasswordError);
  });
});

describe('ConfigStore', () => {
  const configPath = (): string => join(mkdtempSync(join(tmpdir(), 'ma-config-')), 'config.enc');

  it('stores account passwords encrypted', async () => {
    const path = configPath();
    const store = new ConfigStore(path);
    await store.initialize('master-password');
    await store.addAccount({
      name: 'Test',
      email: 'a@b.c',
      host: 'imap.b.c',
      port: 993,
      security: 'tls',
      rejectUnauthorized: true,
      username: 'a@b.c',
      password: 'super-secret-value',
      archivePath: null,
    });

    const raw = await readFile(path, 'utf8');
    expect(raw).not.toContain('super-secret-value');
    expect(raw).not.toContain('imap.b.c');
  });

  it('reopens with the right password and fails with a wrong one', async () => {
    const path = configPath();
    const store = new ConfigStore(path);
    await store.initialize('master-password');
    await store.addAccount({
      name: 'Test',
      email: 'a@b.c',
      host: 'imap.b.c',
      port: 993,
      security: 'tls',
      rejectUnauthorized: true,
      username: 'a@b.c',
      password: 'pw',
      archivePath: null,
    });

    const reopened = new ConfigStore(path);
    await reopened.unlock('master-password');
    expect(reopened.listAccounts()).toHaveLength(1);
    expect(reopened.listPublicAccounts()[0]).not.toHaveProperty('password');

    const wrong = new ConfigStore(path);
    await expect(wrong.unlock('nope')).rejects.toBeInstanceOf(WrongPasswordError);
  });

  it('keeps the stored password when an update omits it', async () => {
    const path = configPath();
    const store = new ConfigStore(path);
    await store.initialize('master-password');
    const account = await store.addAccount({
      name: 'Test',
      email: 'a@b.c',
      host: 'imap.b.c',
      port: 993,
      security: 'tls',
      rejectUnauthorized: true,
      username: 'a@b.c',
      password: 'keep-me',
      archivePath: null,
    });

    await store.updateAccount(account.id, { name: 'Renamed' });
    expect(store.getAccount(account.id)?.password).toBe('keep-me');
    expect(store.getAccount(account.id)?.name).toBe('Renamed');
  });
});

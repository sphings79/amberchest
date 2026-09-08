import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyAddonOptions, isIngressAddress } from '../src/addon.js';

function optionsFile(content: unknown): string {
  const path = join(mkdtempSync(join(tmpdir(), 'ma-addon-')), 'options.json');
  writeFileSync(path, JSON.stringify(content));
  return path;
}

describe('applyAddonOptions', () => {
  it('turns the add-on options into the environment the server reads', () => {
    const env: NodeJS.ProcessEnv = {};
    const path = optionsFile({
      master_password: 'secret',
      cron: '0 3 * * *',
      cron_export_attachments: true,
      log_level: 'debug',
    });

    expect(applyAddonOptions(path, env)).toBe(true);
    expect(env.MAIL_ARCHIVER_MASTER_PASSWORD).toBe('secret');
    expect(env.MAIL_ARCHIVER_CRON).toBe('0 3 * * *');
    expect(env.MAIL_ARCHIVER_CRON_EXPORT_ATTACHMENTS).toBe('true');
    expect(env.MAIL_ARCHIVER_LOG_LEVEL).toBe('debug');
    // Paths that the user did not set get the add-on defaults.
    expect(env.MAIL_ARCHIVER_CONFIG_DIR).toBe('/data/config');
    expect(env.MAIL_ARCHIVER_ARCHIVE_DIR).toBe('/share/mail-archive');
  });

  it('locks the interface to the supervisor when no password was set', () => {
    const env: NodeJS.ProcessEnv = {};
    applyAddonOptions(optionsFile({ master_password: 'secret' }), env);
    expect(env.MAIL_ARCHIVER_INGRESS_ONLY).toBe('true');
  });

  it('leaves the port open when the user chose a password', () => {
    const env: NodeJS.ProcessEnv = {};
    applyAddonOptions(optionsFile({ master_password: 'secret', ui_password: 'ui' }), env);
    expect(env.MAIL_ARCHIVER_UI_PASSWORD).toBe('ui');
    expect(env.MAIL_ARCHIVER_INGRESS_ONLY).toBeUndefined();
  });

  it('never overwrites a password that is already in the environment', () => {
    const env: NodeJS.ProcessEnv = { MAIL_ARCHIVER_MASTER_PASSWORD: 'from-env' };
    applyAddonOptions(optionsFile({ master_password: 'from-options' }), env);
    expect(env.MAIL_ARCHIVER_MASTER_PASSWORD).toBe('from-env');
  });

  it('overrules the paths baked into the image', () => {
    // /config and /archive are gone after an add-on update; /data is not.
    const env: NodeJS.ProcessEnv = {
      MAIL_ARCHIVER_CONFIG_DIR: '/config',
      MAIL_ARCHIVER_ARCHIVE_DIR: '/archive',
    };
    applyAddonOptions(optionsFile({ archive_path: '/share/mail' }), env);
    expect(env.MAIL_ARCHIVER_CONFIG_DIR).toBe('/data/config');
    expect(env.MAIL_ARCHIVER_ARCHIVE_DIR).toBe('/share/mail');
  });

  it('does nothing outside an add-on', () => {
    const env: NodeJS.ProcessEnv = {};
    expect(applyAddonOptions('/nope/options.json', env)).toBe(false);
    expect(Object.keys(env)).toHaveLength(0);
  });
});

describe('isIngressAddress', () => {
  it('accepts the supervisor, in both notations', () => {
    expect(isIngressAddress('172.30.32.2')).toBe(true);
    expect(isIngressAddress('::ffff:172.30.32.2')).toBe(true);
  });

  it('accepts the container itself, which is what the healthcheck uses', () => {
    expect(isIngressAddress('127.0.0.1')).toBe(true);
    expect(isIngressAddress('::1')).toBe(true);
  });

  it('rejects everything else', () => {
    expect(isIngressAddress('192.168.1.10')).toBe(false);
    expect(isIngressAddress('172.30.32.20')).toBe(false);
    expect(isIngressAddress(undefined)).toBe(false);
  });
});

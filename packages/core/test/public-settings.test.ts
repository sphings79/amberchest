import { describe, expect, it } from 'vitest';
import { appSettingsSchema } from '../src/config/schema.js';
import { toPublicSettings } from '../src/config/store.js';
import { TOOLS } from '../src/mcp/tools.js';
import type { AmberChestApp } from '../src/app.js';
import type { AppSettings } from '../src/types.js';

/**
 * get_settings once returned the settings object as it is, which put the MCP
 * bearer token in front of anyone holding read permission - the group that is
 * on as soon as MCP is enabled at all. Reading escalated to everything else.
 *
 * Every secret is named here on purpose. A new one added to the settings has
 * to be added below as well, and until it is, the last test fails.
 */

/** Settings with every secret set, so an omission cannot pass unnoticed. */
function settingsWithSecrets(): AppSettings {
  const settings = appSettingsSchema.parse({}) as AppSettings;
  settings.mcp.token = 'mcp-token-value';
  settings.mqtt.password = 'mqtt-password-value';
  settings.notifications.authHeader = 'Authorization: Bearer notify-value';
  settings.oauth.google.clientSecret = 'google-secret-value';
  settings.oauth.microsoft.clientSecret = 'microsoft-secret-value';
  settings.oauth.custom.clientSecret = 'custom-secret-value';
  return settings;
}

const SECRET_VALUES = [
  'mcp-token-value',
  'mqtt-password-value',
  'notify-value',
  'google-secret-value',
  'microsoft-secret-value',
  'custom-secret-value',
];

describe('toPublicSettings', () => {
  it('reports a token instead of handing it over', () => {
    const publicSettings = toPublicSettings(settingsWithSecrets());
    expect(publicSettings.mcp).not.toHaveProperty('token');
    expect(publicSettings.mcp.hasToken).toBe(true);
  });

  it('reports the broker password, the notification header and the client secrets', () => {
    const publicSettings = toPublicSettings(settingsWithSecrets());
    expect(publicSettings.mqtt).not.toHaveProperty('password');
    expect(publicSettings.mqtt.hasPassword).toBe(true);
    expect(publicSettings.notifications).not.toHaveProperty('authHeader');
    expect(publicSettings.notifications.hasAuthHeader).toBe(true);
    for (const provider of ['google', 'microsoft', 'custom'] as const) {
      expect(publicSettings.oauth[provider]).not.toHaveProperty('clientSecret');
      expect(publicSettings.oauth[provider].hasClientSecret).toBe(true);
    }
  });

  it('says false when a secret was never set', () => {
    const publicSettings = toPublicSettings(appSettingsSchema.parse({}) as AppSettings);
    expect(publicSettings.mcp.hasToken).toBe(false);
    expect(publicSettings.mqtt.hasPassword).toBe(false);
    expect(publicSettings.notifications.hasAuthHeader).toBe(false);
    expect(publicSettings.oauth.google.hasClientSecret).toBe(false);
  });

  it('keeps everything that is not a secret', () => {
    const settings = settingsWithSecrets();
    settings.archivePath = '/somewhere/archive';
    const publicSettings = toPublicSettings(settings);

    expect(publicSettings.archivePath).toBe('/somewhere/archive');
    expect(publicSettings.mcp.permissions).toEqual(settings.mcp.permissions);
    expect(publicSettings.mqtt.url).toBe(settings.mqtt.url);
    expect(publicSettings.mqtt.username).toBe(settings.mqtt.username);
    expect(publicSettings.oauth.google.clientId).toBe(settings.oauth.google.clientId);
    expect(publicSettings.oauth.redirectMode).toBe(settings.oauth.redirectMode);
  });

  it('leaves no secret anywhere in the serialised result', () => {
    const serialised = JSON.stringify(toPublicSettings(settingsWithSecrets()));
    for (const secret of SECRET_VALUES) {
      expect(serialised).not.toContain(secret);
    }
  });

  it('hands nothing secret to the MCP tools that return settings', async () => {
    const settings = settingsWithSecrets();
    // Only what these two handlers touch; a real app would be a fixture the
    // size of the whole application.
    const app = {
      getSettings: () => settings,
      updateSettings: (patch: Partial<AppSettings>) => Promise.resolve({ ...settings, ...patch }),
    } as unknown as AmberChestApp;

    for (const name of ['get_settings', 'update_settings']) {
      const tool = TOOLS.find((entry) => entry.name === name);
      expect(tool, name).toBeDefined();
      const result = JSON.stringify(await tool!.handler(app, {}));
      for (const secret of SECRET_VALUES) {
        expect(result, `${name} leaks ${secret}`).not.toContain(secret);
      }
    }
  });
});

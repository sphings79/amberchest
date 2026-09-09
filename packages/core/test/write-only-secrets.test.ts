import { describe, expect, it } from 'vitest';
import { appSettingsSchema } from '../src/config/schema.js';
import { keepUnsentSecrets, toOperatorSettings } from '../src/config/store.js';
import type { AppSettings } from '../src/types.js';

/**
 * The interface never receives the broker password, the notification header or
 * the OAuth client secrets, so the section it sends back arrives without them.
 * If that counted as "clear it", saving any unrelated switch would wipe a
 * password - which is the failure this guards against.
 */
function stored(): AppSettings {
  const settings = appSettingsSchema.parse({}) as AppSettings;
  settings.mqtt.password = 'broker-secret';
  settings.mqtt.url = 'mqtt://old:1883';
  settings.notifications.authHeader = 'Bearer notify';
  settings.oauth.google.clientSecret = 'google-secret';
  settings.oauth.microsoft.clientSecret = 'microsoft-secret';
  settings.oauth.custom.clientSecret = 'custom-secret';
  return settings;
}

/** What the route does: parse the body, then put the unsent secrets back. */
function patchOf(raw: Record<string, unknown>): Partial<AppSettings> {
  const parsed = appSettingsSchema.partial().safeParse(raw);
  expect(parsed.success).toBe(true);
  const sent = new Set(Object.keys(raw));
  const patch = Object.fromEntries(
    Object.entries(parsed.success ? parsed.data : {}).filter(([key]) => sent.has(key)),
  ) as Partial<AppSettings>;
  return keepUnsentSecrets(stored(), patch, raw);
}

describe('keepUnsentSecrets', () => {
  it('keeps the broker password when the section comes back without it', () => {
    const raw = { mqtt: { ...toOperatorSettings(stored()).mqtt, url: 'mqtt://new:1883' } };
    const patch = patchOf(raw);
    expect(patch.mqtt?.password).toBe('broker-secret');
    expect(patch.mqtt?.url).toBe('mqtt://new:1883');
  });

  it('takes a new password when one was actually typed', () => {
    const patch = patchOf({ mqtt: { password: 'typed-in' } });
    expect(patch.mqtt?.password).toBe('typed-in');
  });

  it('clears a password when an empty string is sent on purpose', () => {
    const patch = patchOf({ mqtt: { password: '' } });
    expect(patch.mqtt?.password).toBe('');
  });

  it('keeps the notification header the same way', () => {
    expect(patchOf({ notifications: { url: 'https://ntfy.sh/x' } }).notifications?.authHeader).toBe(
      'Bearer notify',
    );
    expect(patchOf({ notifications: { authHeader: 'Bearer new' } }).notifications?.authHeader).toBe(
      'Bearer new',
    );
  });

  it('keeps every client secret the provider did not send', () => {
    const raw = { oauth: { google: { clientId: 'new-id' } } };
    const patch = patchOf(raw);
    expect(patch.oauth?.google.clientSecret).toBe('google-secret');
    expect(patch.oauth?.google.clientId).toBe('new-id');
    // The other two are not in the request at all and keep theirs as well.
    expect(patch.oauth?.microsoft.clientSecret).toBe('microsoft-secret');
    expect(patch.oauth?.custom.clientSecret).toBe('custom-secret');
  });

  it('takes a client secret that was typed for one provider only', () => {
    const patch = patchOf({ oauth: { google: { clientSecret: 'rotated' } } });
    expect(patch.oauth?.google.clientSecret).toBe('rotated');
    expect(patch.oauth?.microsoft.clientSecret).toBe('microsoft-secret');
  });

  it('leaves sections the request did not mention alone', () => {
    const patch = patchOf({ theme: 'dark' });
    expect(patch.mqtt).toBeUndefined();
    expect(patch.oauth).toBeUndefined();
    expect(patch.notifications).toBeUndefined();
  });
});

describe('toOperatorSettings', () => {
  it('keeps the MCP token, which the settings screen shows to be copied', () => {
    const settings = stored();
    settings.mcp.token = 'copy-me';
    expect(toOperatorSettings(settings).mcp.token).toBe('copy-me');
  });

  it('sends none of the write only secrets', () => {
    const serialised = JSON.stringify(toOperatorSettings(stored()));
    for (const secret of ['broker-secret', 'Bearer notify', 'google-secret', 'microsoft-secret', 'custom-secret']) {
      expect(serialised).not.toContain(secret);
    }
  });
});

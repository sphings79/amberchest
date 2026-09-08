import { appSettingsSchema } from '@mail-archiver/core';
import { describe, expect, it } from 'vitest';

/**
 * The trap this guards against: a partial schema still applies the default of
 * every section the client did not send, so patching one setting used to reset
 * all the others.
 */
function patchFrom(raw: Record<string, unknown>): Record<string, unknown> {
  const parsed = appSettingsSchema.partial().parse(raw);
  const sent = new Set(Object.keys(raw));
  return Object.fromEntries(Object.entries(parsed).filter(([key]) => sent.has(key)));
}

describe('settings patch', () => {
  it('carries only the sections the client sent', () => {
    const patch = patchFrom({ theme: 'dark' });
    expect(Object.keys(patch)).toEqual(['theme']);
  });

  it('still parses and fills in what is inside a section', () => {
    const patch = patchFrom({ storage: { warnBelowGb: 9, stopBelowGb: 2 } });
    expect(patch).toEqual({ storage: { warnBelowGb: 9, stopBelowGb: 2 } });
  });

  it('does not touch the notification settings when the theme changes', () => {
    // What actually went wrong: the webhook address was silently emptied.
    const patch = patchFrom({ accentColor: 'blue' });
    expect(patch).not.toHaveProperty('notifications');
    expect(patch).not.toHaveProperty('archivePath');
    expect(patch).not.toHaveProperty('mcp');
  });
});

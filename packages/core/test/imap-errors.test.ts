import { describe, expect, it } from 'vitest';
import { describeImapError } from '../src/imap/client.js';

describe('describeImapError', () => {
  const lost = (extra: object) =>
    Object.assign(new Error('Connection not available'), { code: 'NoConnection', ...extra });

  it('says why a connection was lost when the server told', () => {
    const text = describeImapError(lost({ reason: 'Too many simultaneous connections', command: 'FETCH' }));
    expect(text).toBe(
      'Connection not available (server said: Too many simultaneous connections, during FETCH)',
    );
  });

  it('keeps the plain message when nothing more is known', () => {
    expect(describeImapError(lost({}))).toBe('Connection not available');
  });

  const rejected = (extra: object) =>
    Object.assign(new Error('Command failed'), { authenticationFailed: true, ...extra });

  it('passes on what the server said when a login is refused', () => {
    const text = describeImapError(rejected({ responseText: 'Too many failed logins, try again later' }));
    expect(text).toBe(
      'Authentication failed - check user name and password (server said: Too many failed logins, try again later)',
    );
  });

  it('keeps the plain text when the server said nothing', () => {
    expect(describeImapError(rejected({}))).toBe('Authentication failed - check user name and password');
    expect(describeImapError(rejected({ responseText: '  ' }))).toBe(
      'Authentication failed - check user name and password',
    );
  });
});

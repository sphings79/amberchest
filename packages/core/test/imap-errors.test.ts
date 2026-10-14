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
});

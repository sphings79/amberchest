import { createHash } from 'node:crypto';

export interface MessageIdentity {
  messageId: string | null;
  internalDate: Date;
  fromAddress: string | null;
  subject: string | null;
  size: number;
}

/**
 * Stable fingerprint of a message, used to recognise a mail that moved between
 * folders and to avoid re-downloading after a UIDVALIDITY change.
 *
 * All inputs are available from ENVELOPE, INTERNALDATE and RFC822.SIZE, so a
 * move can be detected without downloading the body.
 */
export function messageFingerprint(identity: MessageIdentity): string {
  const time = Number.isNaN(identity.internalDate.getTime()) ? 0 : identity.internalDate.getTime();
  const parts = identity.messageId
    ? [identity.messageId, String(time), identity.fromAddress ?? '', String(identity.size)]
    : [
        '(no-message-id)',
        String(time),
        identity.fromAddress ?? '',
        (identity.subject ?? '').trim().toLowerCase(),
        String(identity.size),
      ];
  return createHash('sha256').update(parts.join(' ')).digest('hex');
}

export function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

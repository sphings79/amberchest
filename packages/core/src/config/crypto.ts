import { createCipheriv, createDecipheriv, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { ScryptOptions } from 'node:crypto';

function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (error, derived) => {
      if (error) reject(error);
      else resolve(derived);
    });
  });
}

/** Key derivation parameters. N=65536 needs roughly 64 MiB of memory. */
export const KDF_PARAMS = { N: 65536, r: 8, p: 1, keyLength: 32 } as const;

const SCRYPT_MAXMEM = 256 * 1024 * 1024;

export interface EncryptedEnvelope {
  v: 1;
  kdf: 'scrypt';
  N: number;
  r: number;
  p: number;
  salt: string;
  iv: string;
  tag: string;
  data: string;
}

export class WrongPasswordError extends Error {
  constructor() {
    super('Wrong master password');
    this.name = 'WrongPasswordError';
  }
}

/**
 * Derives the archive key from the master password.
 *
 * The same routine is used on macOS and inside the container, so a
 * configuration file can be moved between them if the passwords match.
 */
export async function deriveKey(masterPassword: string, salt: Buffer): Promise<Buffer> {
  return scryptAsync(masterPassword.normalize('NFKC'), salt, KDF_PARAMS.keyLength, {
    N: KDF_PARAMS.N,
    r: KDF_PARAMS.r,
    p: KDF_PARAMS.p,
    maxmem: SCRYPT_MAXMEM,
  });
}

export function newSalt(): Buffer {
  return randomBytes(32);
}

/** Encrypts a JSON serialisable value with AES-256-GCM. */
export function encryptJson(value: unknown, key: Buffer, salt: Buffer): EncryptedEnvelope {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  const data = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    v: 1,
    kdf: 'scrypt',
    N: KDF_PARAMS.N,
    r: KDF_PARAMS.r,
    p: KDF_PARAMS.p,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
}

/** Decrypts an envelope; a wrong key fails on the GCM tag. */
export function decryptJson<T>(envelope: EncryptedEnvelope, key: Buffer): T {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  try {
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.data, 'base64')),
      decipher.final(),
    ]);
    return JSON.parse(plaintext.toString('utf8')) as T;
  } catch {
    throw new WrongPasswordError();
  }
}

/** Constant time comparison for tokens and password checks. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

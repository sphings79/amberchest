import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Optional encryption of the archived message files.
 *
 * Off by default, because the whole point of .eml is that any mail client can
 * open it. Switched on, every message file gets sealed with AES-256-GCM using
 * a key derived from the master password - which means the archive can then
 * only be read through Mail Archiver.
 *
 * File layout:
 *   magic "MAENC1"  6 bytes
 *   iv              12 bytes
 *   auth tag        16 bytes
 *   ciphertext      rest
 */

const MAGIC = Buffer.from('MAENC1', 'ascii');
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const HEADER_LENGTH = MAGIC.length + IV_LENGTH + TAG_LENGTH;

export class ArchiveDecryptError extends Error {
  constructor(message = 'Cannot decrypt this file with the current master password') {
    super(message);
    this.name = 'ArchiveDecryptError';
  }
}

/** True when this buffer was written by encryptFile. */
export function isEncrypted(buffer: Buffer): boolean {
  return buffer.length >= HEADER_LENGTH && buffer.subarray(0, MAGIC.length).equals(MAGIC);
}

export function encryptFile(plaintext: Buffer, key: Buffer): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), body]);
}

export function decryptFile(buffer: Buffer, key: Buffer): Buffer {
  if (!isEncrypted(buffer)) throw new ArchiveDecryptError('File is not encrypted');

  const iv = buffer.subarray(MAGIC.length, MAGIC.length + IV_LENGTH);
  const tag = buffer.subarray(MAGIC.length + IV_LENGTH, HEADER_LENGTH);
  const body = buffer.subarray(HEADER_LENGTH);

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    throw new ArchiveDecryptError();
  }
}

/**
 * Reads a message file, transparently decrypting when needed.
 *
 * Mixed archives are fine: files written before encryption was switched on
 * stay readable, because the magic number says which kind a file is.
 */
export function openMessageFile(buffer: Buffer, key: Buffer | null): Buffer {
  if (!isEncrypted(buffer)) return buffer;
  if (!key) throw new ArchiveDecryptError('This archive is encrypted, unlock it first');
  return decryptFile(buffer, key);
}

/** Prepares a message for writing, encrypting when a key is supplied. */
export function sealMessageFile(plaintext: Buffer, key: Buffer | null): Buffer {
  return key ? encryptFile(plaintext, key) : plaintext;
}

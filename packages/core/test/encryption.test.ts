import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  ArchiveDecryptError,
  decryptFile,
  encryptFile,
  isEncrypted,
  openMessageFile,
  sealMessageFile,
} from '../src/storage/encryption.js';

const key = randomBytes(32);
const other = randomBytes(32);
const message = Buffer.from('From: a@b.c\r\nSubject: Rechnung\r\n\r\nBody', 'utf8');

describe('archive encryption', () => {
  it('round trips a message', () => {
    const sealed = encryptFile(message, key);
    expect(decryptFile(sealed, key).equals(message)).toBe(true);
  });

  it('hides the content on disk', () => {
    const sealed = encryptFile(message, key);
    expect(sealed.toString('latin1')).not.toContain('Subject:');
    expect(sealed.subarray(0, 6).toString()).toBe('MAENC1');
  });

  it('produces a different ciphertext every time', () => {
    // A fresh IV per file, so identical messages do not look identical.
    expect(encryptFile(message, key).equals(encryptFile(message, key))).toBe(false);
  });

  it('refuses the wrong key', () => {
    expect(() => decryptFile(encryptFile(message, key), other)).toThrow(ArchiveDecryptError);
  });

  it('detects tampering', () => {
    const sealed = encryptFile(message, key);
    sealed[sealed.length - 1] ^= 0xff;
    expect(() => decryptFile(sealed, key)).toThrow(ArchiveDecryptError);
  });

  it('recognises plain files', () => {
    expect(isEncrypted(message)).toBe(false);
    expect(isEncrypted(encryptFile(message, key))).toBe(true);
  });

  it('reads mixed archives, encrypted or not', () => {
    // Files written before encryption was switched on stay readable.
    expect(openMessageFile(message, key).equals(message)).toBe(true);
    expect(openMessageFile(encryptFile(message, key), key).equals(message)).toBe(true);
  });

  it('explains itself when the key is missing', () => {
    expect(() => openMessageFile(encryptFile(message, key), null)).toThrow(/unlock/i);
  });

  it('writes plain when no key is given', () => {
    expect(sealMessageFile(message, null).equals(message)).toBe(true);
  });
});

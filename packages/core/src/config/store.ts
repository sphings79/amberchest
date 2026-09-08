import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Account, AppConfig, AppSettings, AttachmentSettings, PublicAccount } from '../types.js';
import {
  decryptJson,
  deriveKey,
  encryptJson,
  newSalt,
  WrongPasswordError,
  type EncryptedEnvelope,
} from './crypto.js';
import { configFilePath } from './locations.js';
import {
  accountInputSchema,
  appConfigSchema,
  defaultAccountSettings,
  defaultAppConfig,
  defaultAttachmentSettings,
  defaultOAuth,
  type AccountInput,
} from './schema.js';

export class ConfigLockedError extends Error {
  constructor() {
    super('Configuration is locked');
    this.name = 'ConfigLockedError';
  }
}

export function toPublicAccount(account: Account): PublicAccount {
  const { password, oauth, ...rest } = account;
  return {
    ...rest,
    hasPassword: password.length > 0,
    // Tokens and the client secret never leave the server; the interface only
    // needs to know whether the account is connected and to whom.
    oauth: oauth
      ? {
          provider: oauth.provider,
          scope: oauth.scope,
          expiresAt: oauth.expiresAt,
          connected: oauth.refreshToken.length > 0,
        }
      : null,
  };
}

/**
 * Holds the encrypted configuration.
 *
 * The file only ever exists encrypted on disk. It is unlocked with the master
 * password, which is supplied by the user on macOS or by an environment
 * variable inside the container.
 */
export class ConfigStore {
  private key: Buffer | null = null;
  private salt: Buffer | null = null;
  private config: AppConfig | null = null;

  constructor(private readonly filePath: string = configFilePath()) {}

  get path(): string {
    return this.filePath;
  }

  get isInitialized(): boolean {
    return existsSync(this.filePath);
  }

  get isUnlocked(): boolean {
    return this.config !== null;
  }

  /** Creates a fresh, empty configuration protected by the given password. */
  async initialize(masterPassword: string): Promise<void> {
    if (this.isInitialized) throw new Error('Configuration already exists');
    this.salt = newSalt();
    this.key = await deriveKey(masterPassword, this.salt);
    this.config = defaultAppConfig();
    await this.persist();
  }

  async unlock(masterPassword: string): Promise<void> {
    const raw = await readFile(this.filePath, 'utf8');
    const envelope = JSON.parse(raw) as EncryptedEnvelope;
    const salt = Buffer.from(envelope.salt, 'base64');
    const key = await deriveKey(masterPassword, salt);
    const parsed = appConfigSchema.parse(decryptJson<unknown>(envelope, key));
    this.key = key;
    this.salt = salt;
    this.config = parsed as AppConfig;
  }

  lock(): void {
    this.key = null;
    this.salt = null;
    this.config = null;
  }

  /**
   * The key derived from the master password.
   *
   * Used for the optional archive encryption, so message files are protected
   * by the same secret as the credentials. Null while locked.
   */
  get archiveKey(): Buffer | null {
    return this.key;
  }

  private require(): AppConfig {
    if (!this.config) throw new ConfigLockedError();
    return this.config;
  }

  getSettings(): AppSettings {
    return { ...this.require().settings };
  }

  async updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    const config = this.require();
    config.settings = { ...config.settings, ...patch };
    await this.persist();
    return { ...config.settings };
  }

  listAccounts(): Account[] {
    return this.require().accounts.map((account) => ({ ...account }));
  }

  listPublicAccounts(): PublicAccount[] {
    return this.require().accounts.map(toPublicAccount);
  }

  getAccount(id: string): Account | undefined {
    const account = this.require().accounts.find((candidate) => candidate.id === id);
    return account ? { ...account } : undefined;
  }

  async addAccount(input: AccountInput): Promise<Account> {
    const config = this.require();
    const parsed = accountInputSchema.parse(input);
    const now = new Date().toISOString();
    const account: Account = {
      id: randomUUID(),
      name: parsed.name,
      email: parsed.email,
      host: parsed.host,
      port: parsed.port,
      security: parsed.security,
      rejectUnauthorized: parsed.rejectUnauthorized,
      username: parsed.username,
      password: parsed.password ?? '',
      authType: parsed.authType ?? 'password',
      oauth: parsed.oauth ? { ...defaultOAuth(), ...parsed.oauth } : null,
      archivePath: parsed.archivePath,
      selectedFolders: [],
      settings: { ...defaultAccountSettings(), ...(parsed.settings ?? {}) },
      attachments: defaultAttachmentSettings(),
      createdAt: now,
      updatedAt: now,
    };
    config.accounts.push(account);
    await this.persist();
    return { ...account };
  }

  async updateAccount(id: string, input: Partial<AccountInput>): Promise<Account> {
    const config = this.require();
    const account = config.accounts.find((candidate) => candidate.id === id);
    if (!account) throw new Error(`Unknown account ${id}`);

    if (input.name !== undefined) account.name = input.name;
    if (input.email !== undefined) account.email = input.email;
    if (input.host !== undefined) account.host = input.host;
    if (input.port !== undefined) account.port = input.port;
    if (input.security !== undefined) account.security = input.security;
    if (input.rejectUnauthorized !== undefined) account.rejectUnauthorized = input.rejectUnauthorized;
    if (input.username !== undefined) account.username = input.username;
    // An omitted password keeps the stored one; that is how the UI edits an
    // account without ever sending the secret back and forth.
    if (input.password) account.password = input.password;
    if (input.authType !== undefined) account.authType = input.authType;
    // Null clears the OAuth connection, a partial object patches it - the
    // tokens are never sent back by the interface.
    if (input.oauth === null) account.oauth = null;
    else if (input.oauth) {
      account.oauth = { ...(account.oauth ?? defaultOAuth()), ...input.oauth };
    }
    if (input.archivePath !== undefined) account.archivePath = input.archivePath;
    if (input.settings) account.settings = { ...account.settings, ...input.settings };
    account.updatedAt = new Date().toISOString();

    await this.persist();
    return { ...account };
  }

  async updateAttachmentSettings(
    id: string,
    patch: Partial<AttachmentSettings>,
  ): Promise<AttachmentSettings> {
    const config = this.require();
    const account = config.accounts.find((candidate) => candidate.id === id);
    if (!account) throw new Error(`Unknown account ${id}`);
    account.attachments = { ...defaultAttachmentSettings(), ...account.attachments, ...patch };
    account.updatedAt = new Date().toISOString();
    await this.persist();
    return { ...account.attachments };
  }

  async setSelectedFolders(id: string, folders: string[]): Promise<void> {
    const config = this.require();
    const account = config.accounts.find((candidate) => candidate.id === id);
    if (!account) throw new Error(`Unknown account ${id}`);
    account.selectedFolders = [...new Set(folders)];
    account.updatedAt = new Date().toISOString();
    await this.persist();
  }

  async deleteAccount(id: string): Promise<void> {
    const config = this.require();
    const index = config.accounts.findIndex((candidate) => candidate.id === id);
    if (index === -1) return;
    config.accounts.splice(index, 1);
    await this.persist();
  }

  async changeMasterPassword(current: string, next: string): Promise<void> {
    const config = this.require();
    const raw = await readFile(this.filePath, 'utf8');
    const envelope = JSON.parse(raw) as EncryptedEnvelope;
    const salt = Buffer.from(envelope.salt, 'base64');
    const currentKey = await deriveKey(current, salt);
    // Throws WrongPasswordError when the current password does not match.
    decryptJson<unknown>(envelope, currentKey);

    this.salt = newSalt();
    this.key = await deriveKey(next, this.salt);
    this.config = config;
    await this.persist();
  }

  /** Writes the encrypted file atomically so a crash cannot truncate it. */
  private async persist(): Promise<void> {
    if (!this.config || !this.key || !this.salt) throw new ConfigLockedError();
    const envelope = encryptJson(this.config, this.key, this.salt);
    await mkdir(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    await writeFile(tmp, JSON.stringify(envelope), { mode: 0o600 });
    await rename(tmp, this.filePath);
  }
}

export { WrongPasswordError };

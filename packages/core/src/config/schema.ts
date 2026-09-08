import { z } from 'zod';
import { defaultArchiveDir } from './locations.js';

export const CONFIG_VERSION = 1;

export const accountSettingsSchema = z.object({
  concurrency: z.number().int().min(1).max(8).default(2),
  batchSize: z.number().int().min(10).max(2000).default(200),
  requestDelayMs: z.number().int().min(0).max(10_000).default(0),
  sinceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  deletedHandling: z.enum(['keep', 'move-to-deleted', 'mirror']).default('move-to-deleted'),
  deletedRetentionDays: z.number().int().min(1).max(3650).nullable().default(null),
  autoSelectNewFolders: z.boolean().default(false),
});

export const attachmentSettingsSchema = z.object({
  targetPath: z.string().nullable().default(null),
  layout: z.enum(['folder-tree', 'flat', 'year-month', 'per-message']).default('folder-tree'),
  includeInline: z.boolean().default(false),
  minSizeBytes: z.number().int().min(0).max(1_000_000_000).default(0),
  extensionMode: z.enum(['all', 'include', 'exclude']).default('all'),
  extensions: z.array(z.string()).default([]),
  deduplicate: z.boolean().default(true),
  writeManifest: z.boolean().default(true),
  folders: z.array(z.string()).default([]),
});

/** The tokens one mailbox holds; the client belongs to the instance. */
export const oauthSchema = z.object({
  provider: z.enum(['google', 'microsoft', 'custom']).default('microsoft'),
  refreshToken: z.string().default(''),
  accessToken: z.string().default(''),
  /** Epoch milliseconds, zero when nothing was fetched yet. */
  expiresAt: z.number().int().default(0),
  scope: z.string().default(''),
});

/**
 * One registered client per provider.
 *
 * Neither Google nor Microsoft hands a mailbox scope to an unverified client,
 * so everyone registers their own. Three Gmail accounts share one client, which
 * is why this sits in the settings and not on the account.
 */
export const oauthClientSchema = z.object({
  clientId: z.string().default(''),
  clientSecret: z.string().default(''),
  /** Only for the custom provider. */
  authorizationEndpoint: z.string().default(''),
  tokenEndpoint: z.string().default(''),
  deviceEndpoint: z.string().default(''),
  scopes: z.array(z.string()).default([]),
  imapHost: z.string().default(''),
});

export const oauthSettingsSchema = z.object({
  google: oauthClientSchema.default(() => oauthClientSchema.parse({})),
  microsoft: oauthClientSchema.default(() => oauthClientSchema.parse({})),
  custom: oauthClientSchema.default(() => oauthClientSchema.parse({})),
  /**
   * Where the browser is sent back to. Loopback works everywhere and needs a
   * desktop client registration; a public URL needs a web client and a
   * reachable address.
   */
  redirectMode: z.enum(['loopback', 'public']).default('loopback'),
  publicRedirectUri: z.string().default(''),
});

export const accountSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  email: z.string().min(1),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65_535),
  security: z.enum(['tls', 'starttls', 'none']),
  rejectUnauthorized: z.boolean().default(true),
  username: z.string().min(1),
  password: z.string().default(''),
  /** A password account keeps its password; an OAuth account keeps tokens. */
  authType: z.enum(['password', 'oauth']).default('password'),
  oauth: oauthSchema.nullable().default(null),
  archivePath: z.string().nullable().default(null),
  selectedFolders: z.array(z.string()).default([]),
  settings: accountSettingsSchema,
  attachments: attachmentSettingsSchema.default(() => attachmentSettingsSchema.parse({})),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const searchSettingsSchema = z.object({
  indexAttachments: z.boolean().default(true),
  maxAttachmentBytes: z.number().int().min(0).default(25 * 1024 * 1024),
  autoIndex: z.boolean().default(true),
});

export const mcpSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  httpEnabled: z.boolean().default(false),
  token: z.string().default(''),
  permissions: z
    .object({
      // Reading is the only group that is on once MCP is enabled at all.
      read: z.boolean().default(true),
      backup: z.boolean().default(false),
      export: z.boolean().default(false),
      accountsWrite: z.boolean().default(false),
      settingsWrite: z.boolean().default(false),
      delete: z.boolean().default(false),
    })
    .default(() => ({
      read: true,
      backup: false,
      export: false,
      accountsWrite: false,
      settingsWrite: false,
      delete: false,
    })),
});

export const mqttSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  /** mqtt:// mqtts:// ws:// wss:// with an optional port. */
  url: z.string().default(''),
  username: z.string().default(''),
  password: z.string().default(''),
  clientId: z.string().default(''),
  /** Everything is published below this topic. */
  baseTopic: z.string().min(1).default('mailarchiver'),
  /** Publish the Home Assistant discovery messages. */
  discovery: z.boolean().default(true),
  discoveryPrefix: z.string().min(1).default('homeassistant'),
  retain: z.boolean().default(true),
  /** Off means the bridge only reports and never accepts a command. */
  allowCommands: z.boolean().default(true),
  publishIntervalSeconds: z.number().int().min(10).max(3600).default(60),
  /** Only relevant for mqtts:// with a self signed certificate. */
  rejectUnauthorized: z.boolean().default(true),
});

export const appSettingsSchema = z.object({
  archivePath: z.string().min(1).default(defaultArchiveDir()),
  language: z.enum(['de', 'en']).default('de'),
  theme: z.enum(['light', 'dark', 'system']).default('system'),
  accentColor: z.string().default('violet'),
  search: searchSettingsSchema.default(() => searchSettingsSchema.parse({})),
  mcp: mcpSettingsSchema.default(() => mcpSettingsSchema.parse({})),
  mqtt: mqttSettingsSchema.default(() => mqttSettingsSchema.parse({})),
  oauth: oauthSettingsSchema.default(() => oauthSettingsSchema.parse({})),
  encryptArchive: z.boolean().default(false),
});

export const appConfigSchema = z.object({
  version: z.number().int().default(CONFIG_VERSION),
  settings: appSettingsSchema,
  accounts: z.array(accountSchema).default([]),
});

/** Payload accepted when creating or updating an account from the API. */
export const accountInputSchema = z.object({
  name: z.string().min(1),
  email: z.string().min(1),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65_535),
  security: z.enum(['tls', 'starttls', 'none']),
  rejectUnauthorized: z.boolean().default(true),
  username: z.string().min(1),
  /** Omitted on update means "keep the stored password". */
  password: z.string().optional(),
  authType: z.enum(['password', 'oauth']).optional(),
  oauth: oauthSchema.partial().nullable().optional(),
  archivePath: z.string().nullable().default(null),
  settings: accountSettingsSchema.partial().optional(),
});

export type AccountInput = z.infer<typeof accountInputSchema>;

export function defaultAccountSettings() {
  return accountSettingsSchema.parse({});
}

export function defaultOAuth() {
  return oauthSchema.parse({});
}

export function defaultOAuthClient() {
  return oauthClientSchema.parse({});
}

export function defaultAttachmentSettings() {
  return attachmentSettingsSchema.parse({});
}

export function defaultAppConfig() {
  return appConfigSchema.parse({ settings: {} });
}

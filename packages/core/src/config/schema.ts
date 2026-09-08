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
  archivePath: z.string().nullable().default(null),
  selectedFolders: z.array(z.string()).default([]),
  settings: accountSettingsSchema,
  attachments: attachmentSettingsSchema.default(() => attachmentSettingsSchema.parse({})),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const appSettingsSchema = z.object({
  archivePath: z.string().min(1).default(defaultArchiveDir()),
  language: z.enum(['de', 'en']).default('de'),
  theme: z.enum(['light', 'dark', 'system']).default('system'),
  accentColor: z.string().default('violet'),
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
  archivePath: z.string().nullable().default(null),
  settings: accountSettingsSchema.partial().optional(),
});

export type AccountInput = z.infer<typeof accountInputSchema>;

export function defaultAccountSettings() {
  return accountSettingsSchema.parse({});
}

export function defaultAttachmentSettings() {
  return attachmentSettingsSchema.parse({});
}

export function defaultAppConfig() {
  return appConfigSchema.parse({ settings: {} });
}

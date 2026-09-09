import type { AmberChestApp } from '../app.js';
import type { BundleFormat } from '../export/bundle.js';
import type { SearchField, SearchSort } from '../search/search.js';
import { toPublicSettings } from '../config/store.js';
import { logger } from '../util/logger.js';

/**
 * The tools an AI can call, grouped by what they are allowed to touch.
 *
 * Every group has its own switch in the settings, so "let it search my mail"
 * and "let it delete an account" are separate decisions. Only `read` is on by
 * default.
 */
export type McpPermission =
  | 'read'
  | 'backup'
  | 'export'
  | 'accountsWrite'
  | 'settingsWrite'
  | 'delete';

export const MCP_PERMISSIONS: McpPermission[] = [
  'read',
  'backup',
  'export',
  'accountsWrite',
  'settingsWrite',
  'delete',
];

export interface McpPermissions {
  read: boolean;
  backup: boolean;
  export: boolean;
  accountsWrite: boolean;
  settingsWrite: boolean;
  delete: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  permission: McpPermission;
  /** JSON Schema of the arguments, as the MCP protocol expects it. */
  inputSchema: Record<string, unknown>;
  handler: (app: AmberChestApp, args: Record<string, unknown>) => Promise<unknown> | unknown;
}

function str(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function num(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  return typeof value === 'number' ? value : undefined;
}

function bool(args: Record<string, unknown>, key: string): boolean | undefined {
  const value = args[key];
  return typeof value === 'boolean' ? value : undefined;
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = str(args, key);
  if (!value) throw new Error(`Missing argument: ${key}`);
  return value;
}

const objectSchema = (
  properties: Record<string, unknown>,
  required: string[] = [],
): Record<string, unknown> => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});

const STRING = { type: 'string' };
const NUMBER = { type: 'number' };
const BOOLEAN = { type: 'boolean' };

export const TOOLS: ToolDefinition[] = [
  // ------------------------------------------------------------------ read
  {
    name: 'list_accounts',
    description:
      'Lists the configured mail accounts with their archive statistics. Never returns passwords.',
    permission: 'read',
    inputSchema: objectSchema({}),
    handler: (app) =>
      app.overview().map((entry) => ({
        id: entry.account.id,
        name: entry.account.name,
        email: entry.account.email,
        host: entry.account.host,
        messages: entry.messageCount,
        indexed: entry.indexedCount,
        folders: entry.account.selectedFolders,
        archivedBytes: entry.bytes,
        attachmentsExported: entry.attachmentCount,
        lastBackup: (entry.lastRun as { started_at?: string } | null)?.started_at ?? null,
        backupRunning: entry.running,
      })),
  },
  {
    name: 'list_folders',
    description: 'Lists the archived folders of one account, with the number of messages in each.',
    permission: 'read',
    inputSchema: objectSchema({ account_id: STRING }, ['account_id']),
    handler: (app, args) => {
      const accountId = requireString(args, 'account_id');
      return app.db.listFolders(accountId).map((folder) => ({
        path: folder.path,
        localPath: folder.local_path,
        specialUse: folder.special_use,
        selected: folder.selected === 1,
        messages: app.db.countMessages(folder.id),
        lastSync: folder.last_sync,
      }));
    },
  },
  {
    name: 'search_messages',
    description:
      'Full text search over subject, sender, recipient, message body and attachment content. ' +
      'Returns matches with a highlighted snippet. Leave the query empty to browse by filters alone.',
    permission: 'read',
    inputSchema: objectSchema({
      query: STRING,
      account_id: STRING,
      folders: { type: 'array', items: STRING },
      from: STRING,
      to: STRING,
      field: {
        ...STRING,
        description: 'Restrict the query to one field: all, subject, from, to, body, attachments',
      },
      sort: {
        ...STRING,
        description: 'relevance (default), date-desc, date-asc, size-desc, size-asc',
      },
      date_from: { ...STRING, description: 'ISO date, inclusive' },
      date_to: { ...STRING, description: 'ISO date, inclusive' },
      with_attachments: BOOLEAN,
      unread_only: BOOLEAN,
      flagged_only: BOOLEAN,
      include_deleted: { ...BOOLEAN, description: 'Also return messages that vanished on the server' },
      min_size: { ...NUMBER, description: 'Bytes' },
      max_size: { ...NUMBER, description: 'Bytes' },
      limit: { ...NUMBER, description: 'Default 25, maximum 200' },
      offset: NUMBER,
    }),
    handler: (app, args) => {
      const folders = Array.isArray(args.folders) ? (args.folders as string[]) : [];
      const result = app.search({
        query: str(args, 'query') ?? '',
        accountId: str(args, 'account_id') ?? null,
        folders,
        from: str(args, 'from') ?? null,
        to: str(args, 'to') ?? null,
        field: (str(args, 'field') as SearchField | undefined) ?? 'all',
        sort: (str(args, 'sort') as SearchSort | undefined) ?? 'relevance',
        dateFrom: str(args, 'date_from') ?? null,
        dateTo: str(args, 'date_to') ?? null,
        withAttachments: bool(args, 'with_attachments') ?? false,
        unreadOnly: bool(args, 'unread_only') ?? false,
        flaggedOnly: bool(args, 'flagged_only') ?? false,
        includeDeleted: bool(args, 'include_deleted') ?? false,
        minSize: num(args, 'min_size') ?? null,
        maxSize: num(args, 'max_size') ?? null,
        limit: Math.min(num(args, 'limit') ?? 25, 200),
        offset: num(args, 'offset') ?? 0,
      });
      return {
        total: result.total,
        hits: result.hits.map((hit) => ({
          message_id: hit.messageId,
          account_id: hit.accountId,
          folder: hit.folderPath,
          subject: hit.subject,
          from: hit.fromAddr,
          to: hit.toAddr,
          date: hit.internalDate,
          attachments: hit.attachmentCount,
          // The snippet carries <mark> tags; strip them for a language model.
          snippet: hit.snippet?.replace(/<\/?mark>/g, '') ?? null,
        })),
      };
    },
  },
  {
    name: 'verify_archive',
    description:
      'Checks the archived files of one account against the checksums taken when they were ' +
      'downloaded, looks for files the index does not know, and optionally asks the server how ' +
      'many messages each folder holds. Changes nothing.',
    permission: 'backup',
    inputSchema: objectSchema(
      {
        account_id: STRING,
        check_server: { ...BOOLEAN, description: 'Also compare the folder counts with the server' },
        include_deleted: { ...BOOLEAN, description: 'Also check the _deleted tree' },
      },
      ['account_id'],
    ),
    handler: async (app, args) => {
      const result = await app.startVerify(requireString(args, 'account_id'), {
        checkServer: bool(args, 'check_server') ?? false,
        includeDeleted: bool(args, 'include_deleted') ?? false,
      });
      return {
        status: result.phase,
        ...result.stats,
        findings: result.findings.map((finding) => ({
          kind: finding.kind,
          path: finding.path,
          detail: finding.detail,
          ...finding.detailParams,
        })),
      };
    },
  },
  {
    name: 'get_message',
    description:
      'Reads one archived message: headers, plain text body and the list of attachments. ' +
      'Use search_messages first to find the message id.',
    permission: 'read',
    inputSchema: objectSchema({ account_id: STRING, message_id: NUMBER }, ['account_id', 'message_id']),
    handler: async (app, args) => {
      const message = await app.loadMessage(requireString(args, 'account_id'), num(args, 'message_id') ?? 0);
      return {
        subject: message.subject,
        from: message.from,
        to: message.to,
        cc: message.cc,
        date: message.date,
        folder: message.folderPath,
        // HTML is not returned: a model gets more out of the text version, and
        // it keeps the payload small.
        text: message.text,
        attachments: message.attachments.map((attachment) => ({
          index: attachment.index,
          name: attachment.name,
          contentType: attachment.contentType,
          size: attachment.size,
          inline: attachment.inline,
        })),
        filePath: message.filePath,
      };
    },
  },
  {
    name: 'get_attachment_text',
    description:
      'Extracts the text of one attachment (PDF, Word, Excel, PowerPoint, plain text, or the files ' +
      'inside a ZIP or TAR archive). Returns an empty string when the file holds no text.',
    permission: 'read',
    inputSchema: objectSchema({ account_id: STRING, message_id: NUMBER, index: NUMBER }, [
      'account_id',
      'message_id',
      'index',
    ]),
    handler: async (app, args) => {
      const attachment = await app.loadAttachment(
        requireString(args, 'account_id'),
        num(args, 'message_id') ?? 0,
        num(args, 'index') ?? 0,
      );
      const { extractText } = await import('../search/text.js');
      return {
        name: attachment.name,
        contentType: attachment.contentType,
        text: await extractText(attachment.content, attachment.contentType, attachment.name),
      };
    },
  },
  {
    name: 'get_settings',
    description:
      'Returns the application settings without any secrets: archive path, language, theme, ' +
      'search, storage and the switches for MCP, MQTT, OAuth and notifications. Tokens, ' +
      'passwords and client secrets are reported as a hasX flag, never as a value.',
    permission: 'read',
    inputSchema: objectSchema({}),
    handler: (app) => toPublicSettings(app.getSettings()),
  },

  // ---------------------------------------------------------------- backup
  {
    name: 'start_backup',
    description:
      'Starts a backup run for one account. Returns immediately; use list_accounts to follow the progress.',
    permission: 'backup',
    inputSchema: objectSchema({ account_id: STRING }, ['account_id']),
    handler: (app, args) => {
      const accountId = requireString(args, 'account_id');
      void app.startSyncAndIndex(accountId).catch(() => undefined);
      return { started: true, account_id: accountId };
    },
  },
  {
    name: 'cancel_backup',
    description: 'Stops the backup that is currently running for an account.',
    permission: 'backup',
    inputSchema: objectSchema({ account_id: STRING }, ['account_id']),
    handler: (app, args) => ({ cancelled: app.cancelSync(requireString(args, 'account_id')) }),
  },
  {
    name: 'build_search_index',
    description: 'Indexes the messages of an account that are not in the full text index yet.',
    permission: 'backup',
    inputSchema: objectSchema({ account_id: STRING }, ['account_id']),
    handler: (app, args) => {
      const accountId = requireString(args, 'account_id');
      void app.startIndexing(accountId).catch(() => undefined);
      return { started: true, account_id: accountId };
    },
  },

  // ---------------------------------------------------------------- export
  {
    name: 'export_attachments',
    description:
      'Runs the attachment export for one account with its stored settings, writing the files to the ' +
      'configured target directory.',
    permission: 'export',
    inputSchema: objectSchema({ account_id: STRING }, ['account_id']),
    handler: (app, args) => {
      const accountId = requireString(args, 'account_id');
      void app.startAttachmentExport(accountId).catch(() => undefined);
      return { started: true, target: app.getAttachmentSettings(accountId).targetPath };
    },
  },
  {
    name: 'create_export_bundle',
    description:
      'Packs the messages matching a search into one file: eml-zip, mbox or pdf-zip. ' +
      'Returns a bundle id; ask again with list_export_bundles to get the finished file path.',
    permission: 'export',
    inputSchema: objectSchema(
      {
        format: { type: 'string', enum: ['eml-zip', 'mbox', 'pdf-zip'] },
        query: STRING,
        account_id: STRING,
        folders: { type: 'array', items: STRING },
        from: STRING,
        date_from: STRING,
        date_to: STRING,
        with_attachments: BOOLEAN,
      },
      ['format'],
    ),
    handler: (app, args) => {
      const folders = Array.isArray(args.folders) ? (args.folders as string[]) : [];
      const bundleId = app.startBundle(requireString(args, 'format') as BundleFormat, {
        query: str(args, 'query') ?? '',
        accountId: str(args, 'account_id') ?? null,
        folders,
        from: str(args, 'from') ?? null,
        dateFrom: str(args, 'date_from') ?? null,
        dateTo: str(args, 'date_to') ?? null,
        withAttachments: bool(args, 'with_attachments') ?? false,
      });
      return { bundle_id: bundleId };
    },
  },
  {
    name: 'list_export_bundles',
    description: 'Lists the export files that were produced, with their path on disk.',
    permission: 'export',
    inputSchema: objectSchema({}),
    handler: (app) => app.bundles.list(),
  },

  // -------------------------------------------------------- accounts write
  {
    name: 'create_account',
    description:
      'Adds an IMAP account. The password is stored encrypted and can never be read back through this interface.',
    permission: 'accountsWrite',
    inputSchema: objectSchema(
      {
        name: STRING,
        email: STRING,
        host: STRING,
        port: NUMBER,
        security: { type: 'string', enum: ['tls', 'starttls', 'none'] },
        username: STRING,
        password: STRING,
        reject_unauthorized: BOOLEAN,
      },
      ['name', 'email', 'host', 'port', 'security', 'username', 'password'],
    ),
    handler: async (app, args) =>
      app.addAccount({
        name: requireString(args, 'name'),
        email: requireString(args, 'email'),
        host: requireString(args, 'host'),
        port: num(args, 'port') ?? 993,
        security: requireString(args, 'security') as 'tls' | 'starttls' | 'none',
        username: requireString(args, 'username'),
        password: requireString(args, 'password'),
        rejectUnauthorized: bool(args, 'reject_unauthorized') ?? true,
        archivePath: null,
      }),
  },
  {
    name: 'set_selected_folders',
    description: 'Sets which IMAP folders of an account are archived.',
    permission: 'accountsWrite',
    inputSchema: objectSchema({ account_id: STRING, folders: { type: 'array', items: STRING } }, [
      'account_id',
      'folders',
    ]),
    handler: async (app, args) => {
      const folders = Array.isArray(args.folders) ? (args.folders as string[]) : [];
      await app.setSelectedFolders(requireString(args, 'account_id'), folders);
      return { ok: true, folders };
    },
  },
  {
    name: 'list_remote_folders',
    description:
      'Asks the mail server which folders it has. Needs a working connection and is slower than list_folders.',
    permission: 'accountsWrite',
    inputSchema: objectSchema({ account_id: STRING }, ['account_id']),
    handler: async (app, args) => {
      const tree = await app.getFolderTree(requireString(args, 'account_id'), true);
      const flat: unknown[] = [];
      const walk = (nodes: typeof tree): void => {
        for (const node of nodes) {
          flat.push({
            path: node.path,
            specialUse: node.specialUse,
            selected: node.selected,
            isNew: node.isNew,
            messages: node.messageCount,
          });
          walk(node.children);
        }
      };
      walk(tree);
      return flat;
    },
  },

  // -------------------------------------------------------- settings write
  {
    name: 'update_settings',
    description: 'Changes application settings such as the archive path, language or theme.',
    permission: 'settingsWrite',
    inputSchema: objectSchema({
      archive_path: STRING,
      language: { type: 'string', enum: ['de', 'en'] },
      theme: { type: 'string', enum: ['light', 'dark', 'system'] },
      accent_color: STRING,
    }),
    handler: async (app, args) => {
      const patch: Record<string, unknown> = {};
      if (str(args, 'archive_path')) patch.archivePath = str(args, 'archive_path');
      if (str(args, 'language')) patch.language = str(args, 'language');
      if (str(args, 'theme')) patch.theme = str(args, 'theme');
      if (str(args, 'accent_color')) patch.accentColor = str(args, 'accent_color');
      return toPublicSettings(await app.updateSettings(patch));
    },
  },
  {
    name: 'update_attachment_settings',
    description: 'Changes the attachment export settings of one account.',
    permission: 'settingsWrite',
    inputSchema: objectSchema(
      {
        account_id: STRING,
        target_path: STRING,
        layout: { type: 'string', enum: ['folder-tree', 'flat', 'year-month', 'per-message'] },
        include_inline: BOOLEAN,
        min_size_bytes: NUMBER,
        deduplicate: BOOLEAN,
      },
      ['account_id'],
    ),
    handler: async (app, args) => {
      const patch: Record<string, unknown> = {};
      if (str(args, 'target_path')) patch.targetPath = str(args, 'target_path');
      if (str(args, 'layout')) patch.layout = str(args, 'layout');
      if (bool(args, 'include_inline') !== undefined) patch.includeInline = bool(args, 'include_inline');
      if (num(args, 'min_size_bytes') !== undefined) patch.minSizeBytes = num(args, 'min_size_bytes');
      if (bool(args, 'deduplicate') !== undefined) patch.deduplicate = bool(args, 'deduplicate');
      return app.updateAttachmentSettings(requireString(args, 'account_id'), patch);
    },
  },

  // ---------------------------------------------------------------- delete
  {
    name: 'delete_account',
    description:
      'Removes an account from the configuration and drops its index. The archived files on disk are kept.',
    permission: 'delete',
    inputSchema: objectSchema({ account_id: STRING }, ['account_id']),
    handler: async (app, args) => {
      const accountId = requireString(args, 'account_id');
      const account = app.requireAccount(accountId);
      await app.deleteAccount(accountId);
      logger.warn(`Account ${account.name} was deleted through MCP`);
      return { deleted: true, name: account.name };
    },
  },
  {
    name: 'reset_search_index',
    description: 'Drops the full text index of an account so it can be rebuilt from scratch.',
    permission: 'delete',
    inputSchema: objectSchema({ account_id: STRING }, ['account_id']),
    handler: (app, args) => {
      app.resetIndex(requireString(args, 'account_id'));
      return { ok: true };
    },
  },
];

/** The tools that are usable with the given permissions. */
export function availableTools(permissions: McpPermissions): ToolDefinition[] {
  return TOOLS.filter((tool) => permissions[tool.permission]);
}

export class ToolNotAllowedError extends Error {
  constructor(name: string) {
    super(`Tool ${name} is not enabled in the AmberChest settings`);
    this.name = 'ToolNotAllowedError';
  }
}

/** Runs one tool after checking that its permission group is switched on. */
export async function callTool(
  app: AmberChestApp,
  permissions: McpPermissions,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const tool = TOOLS.find((entry) => entry.name === name);
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  if (!permissions[tool.permission]) throw new ToolNotAllowedError(name);

  logger.info(`MCP tool called: ${name}`);
  return tool.handler(app, args);
}

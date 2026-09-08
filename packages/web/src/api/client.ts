import type {
  AccountOverview,
  AppSettings,
  AttachmentSettings,
  ConnectionTestResult,
  ExportProgress,
  FolderTreeNode,
  IndexProgress,
  LogEntry,
  MessageContent,
  MigrationProgress,
  DeviceCode,
  MqttStatus,
  PublicAccount,
  SearchResult,
  TransferProgress,
  VerifyProgress,
} from '@mail-archiver/core';

export type {
  AccountOverview,
  AppSettings,
  AttachmentSettings,
  ConnectionTestResult,
  ExportProgress,
  FolderTreeNode,
  IndexProgress,
  LogEntry,
  MessageContent,
  MigrationProgress,
  DeviceCode,
  MqttStatus,
  PublicAccount,
  SearchResult,
  TransferProgress,
  VerifyProgress,
};

/** What the statistics screen shows; all of it comes out of the index. */
export interface Statistics {
  perYear: Array<{ year: string; messages: number; bytes: number }>;
  perFolder: Array<{ path: string; messages: number; bytes: number }>;
  topSenders: Array<{ address: string; messages: number; bytes: number }>;
  largest: Array<{
    id: number;
    accountId: string;
    subject: string | null;
    from: string | null;
    date: string;
    size: number;
  }>;
  attachments: {
    files: number;
    bytes: number;
    byType: Array<{ type: string; files: number; bytes: number }>;
  };
  totals: {
    messages: number;
    bytes: number;
    deleted: number;
    linked: number;
    withAttachments: number;
  };
  range: { first: string | null; last: string | null };
}

export interface RestoreTarget {
  host: string;
  port: number;
  security: 'tls' | 'starttls' | 'none';
  rejectUnauthorized: boolean;
  username: string;
  password: string;
  /** Use the stored password of this account instead of sending one. */
  useAccountId?: string | undefined;
}

export interface SearchQuery {
  q: string;
  account?: string | undefined;
  folders?: string[];
  from?: string | undefined;
  to?: string | undefined;
  field?: SearchField;
  sort?: SearchSort;
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
  withAttachments?: boolean;
  unreadOnly?: boolean;
  flaggedOnly?: boolean;
  includeDeleted?: boolean;
  /** Sizes in bytes. */
  minSize?: number | undefined;
  maxSize?: number | undefined;
  limit?: number;
  offset?: number;
}

export type SearchField = 'all' | 'subject' | 'from' | 'to' | 'body' | 'attachments';
export type SearchSort = 'relevance' | 'date-desc' | 'date-asc' | 'size-desc' | 'size-asc';

export interface AttachmentState {
  settings: AttachmentSettings;
  files: number;
  bytes: number;
  running: boolean;
  progress: ExportProgress | null;
  runs: Array<Record<string, unknown>>;
}

export interface ServerState {
  initialized: boolean;
  unlocked: boolean;
  authMode: 'none' | 'token' | 'password';
  authenticated: boolean;
  settings: AppSettings | null;
}

export interface AccountFormValues {
  authType?: 'password' | 'oauth';
  name: string;
  email: string;
  host: string;
  port: number;
  security: 'tls' | 'starttls' | 'none';
  rejectUnauthorized: boolean;
  username: string;
  password?: string;
  archivePath: string | null;
  settings?: Partial<AccountSettingsValues>;
}

export interface AccountSettingsValues {
  concurrency: number;
  batchSize: number;
  requestDelayMs: number;
  sinceDate: string | null;
  deletedHandling: 'keep' | 'move-to-deleted' | 'mirror';
  deletedRetentionDays: number | null;
  autoSelectNewFolders: boolean;
  linkDuplicates: boolean;
  protectBeforeDate: string | null;
}

import {
  LOCAL_CONNECTION,
  getActiveConnection,
  getConnectionToken,
  setActiveConnectionId,
  setConnectionToken,
  type Connection,
} from './connections.js';

const TOKEN_KEY = 'mail-archiver-token';

/**
 * The desktop app opens the UI with `?token=...`; the container hands out a
 * token after the password login. Either way it lives in sessionStorage only.
 */
function readInitialToken(): string | null {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get('token');
  if (fromUrl) sessionStorage.setItem(TOKEN_KEY, fromUrl);
  if (fromUrl || params.has('desktop')) {
    const url = new URL(window.location.href);
    url.searchParams.delete('token');
    url.searchParams.delete('desktop');
    window.history.replaceState({}, '', url.toString());
  }
  return fromUrl ?? sessionStorage.getItem(TOKEN_KEY);
}

/** True when the UI is hosted by the Electron shell (window controls overlap). */
export const isDesktop = new URLSearchParams(window.location.search).has('desktop');

let connection: Connection = getActiveConnection();
let token: string | null =
  connection.id === LOCAL_CONNECTION.id ? readInitialToken() : getConnectionToken(connection.id);

/** The connection every request currently goes to. */
export function getConnection(): Connection {
  return connection;
}

/** Switches the target; the caller reloads the state afterwards. */
export function useConnection(next: Connection): void {
  connection = next;
  setActiveConnectionId(next.id);
  token =
    next.id === LOCAL_CONNECTION.id
      ? sessionStorage.getItem(TOKEN_KEY)
      : getConnectionToken(next.id);
}

export function setToken(value: string | null): void {
  token = value;
  if (connection.id === LOCAL_CONNECTION.id) {
    if (value) sessionStorage.setItem(TOKEN_KEY, value);
    else sessionStorage.removeItem(TOKEN_KEY);
  } else {
    setConnectionToken(connection.id, value);
  }
}

export function getToken(): string | null {
  return token;
}

/** Absolute or relative base, depending on where we are pointed. */
export function apiBase(): string {
  return connection.url ? `${connection.url}/api` : 'api';
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  // Fastify rejects an empty body when the content type announces JSON, so the
  // header is only set for requests that actually carry one.
  if (init.body !== undefined) headers.set('content-type', 'application/json');
  if (token) headers.set('authorization', `Bearer ${token}`);

  const response = await fetch(`${apiBase()}${path}`, { ...init, headers });
  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : null;

  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as { error: unknown }).error)
        : response.statusText;
    throw new ApiError(response.status, message);
  }
  return payload as T;
}

export const api = {
  state: () => request<ServerState>('/state'),
  login: (password: string) => request<{ token: string }>('/login', {
    method: 'POST',
    body: JSON.stringify({ password }),
  }),
  setup: (masterPassword: string) =>
    request<{ ok: true }>('/setup', { method: 'POST', body: JSON.stringify({ masterPassword }) }),
  unlock: (masterPassword: string) =>
    request<{ ok: true }>('/unlock', { method: 'POST', body: JSON.stringify({ masterPassword }) }),
  lock: () => request<{ ok: true }>('/lock', { method: 'POST' }),

  settings: () => request<AppSettings>('/settings'),
  updateSettings: (patch: Partial<AppSettings>) =>
    request<AppSettings>('/settings', { method: 'PATCH', body: JSON.stringify(patch) }),

  accounts: () => request<AccountOverview[]>('/accounts'),
  createAccount: (values: AccountFormValues) =>
    request<PublicAccount>('/accounts', { method: 'POST', body: JSON.stringify(values) }),
  updateAccount: (id: string, values: Partial<AccountFormValues>) =>
    request<PublicAccount>(`/accounts/${id}`, { method: 'PATCH', body: JSON.stringify(values) }),
  deleteAccount: (id: string) => request<{ ok: true }>(`/accounts/${id}`, { method: 'DELETE' }),
  testConnection: (values: {
    host: string;
    port: number;
    security: 'tls' | 'starttls' | 'none';
    rejectUnauthorized: boolean;
    username: string;
    password: string;
    accountId?: string;
  }) => request<ConnectionTestResult>('/accounts/test', { method: 'POST', body: JSON.stringify(values) }),

  localFolders: (id: string) =>
    request<
      Array<{
        path: string;
        name: string;
        delimiter: string;
        specialUse: string | null;
        messages: number;
        lastSync: string | null;
      }>
    >(`/accounts/${id}/local-folders`),

  folders: (id: string, withCounts: boolean) =>
    request<FolderTreeNode[]>(`/accounts/${id}/folders${withCounts ? '?counts=1' : ''}`),
  saveFolders: (id: string, folders: string[]) =>
    request<{ ok: true }>(`/accounts/${id}/folders`, { method: 'PUT', body: JSON.stringify({ folders }) }),

  startSync: (id: string) => request<{ started: boolean }>(`/accounts/${id}/sync`, { method: 'POST' }),
  cancelSync: (id: string) =>
    request<{ cancelled: boolean }>(`/accounts/${id}/sync/cancel`, { method: 'POST' }),

  startTransfer: (
    id: string,
    body: { url: string; token: string; accountId: string; includeDeleted?: boolean },
  ) => request<{ started: boolean }>(`/accounts/${id}/transfer`, {
    method: 'POST',
    body: JSON.stringify(body),
  }),
  cancelTransfer: (id: string) =>
    request<{ cancelled: boolean }>(`/accounts/${id}/transfer/cancel`, { method: 'POST' }),
  adoptArchive: (id: string, body: { askServer?: boolean; includeDeleted?: boolean }) =>
    request<{ phase: string; stats: Record<string, number>; guessedFolders: string[] }>(
      `/accounts/${id}/adopt`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  writeRegister: (id: string) =>
    request<{ indexPath: string; folders: number; messages: number }>(`/accounts/${id}/register`, {
      method: 'POST',
    }),

  statistics: (accountId?: string) =>
    request<Statistics>(`/statistics${accountId ? `?account=${encodeURIComponent(accountId)}` : ''}`),

  storage: () =>
    request<{
      space: { free: number; total: number; path: string } | null;
      warnBelow: number;
      stopBelow: number;
      low: boolean;
    }>('/storage'),
  testNotification: () =>
    request<{ ok: boolean; error?: string }>('/notifications/test', { method: 'POST' }),

  startVerify: (id: string, body: { checkServer?: boolean; includeDeleted?: boolean }) =>
    request<{ started: boolean }>(`/accounts/${id}/verify`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  cancelVerify: (id: string) =>
    request<{ cancelled: boolean }>(`/accounts/${id}/verify/cancel`, { method: 'POST' }),
  lastVerify: (id: string) =>
    request<{ run: VerifyProgress | null; running: boolean }>(`/accounts/${id}/verify`),

  oauthProviders: () =>
    request<{
      redirectMode: 'loopback' | 'public';
      publicRedirectUri: string;
      callbackPath: string;
      providers: Array<{
        id: 'google' | 'microsoft' | 'custom';
        name: string;
        deviceFlow: boolean;
        scopes: string[];
        imapHost: string;
        imapPort: number;
        configured: boolean;
        clientSecretUsed: boolean;
      }>;
    }>('/oauth/providers'),
  oauthStartDevice: (accountId: string, provider: string) =>
    request<DeviceCode>(`/accounts/${accountId}/oauth/device`, {
      method: 'POST',
      body: JSON.stringify({ provider }),
    }),
  oauthDeviceStatus: (accountId: string) =>
    request<{ code: DeviceCode | null; connected: boolean; error: string | null }>(
      `/accounts/${accountId}/oauth/device`,
    ),
  oauthAuthorize: (accountId: string, body: { provider: string; mode?: string; loopbackPort?: number }) =>
    request<{ url: string; state: string; redirectUri: string }>(
      `/accounts/${accountId}/oauth/authorize`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  oauthComplete: (input: string, state?: string) =>
    request<{ accountId: string }>('/oauth/complete', {
      method: 'POST',
      body: JSON.stringify({ input, ...(state ? { state } : {}) }),
    }),

  mqttStatus: () => request<MqttStatus>('/mqtt'),
  mqttReconnect: () => request<MqttStatus>('/mqtt/reconnect', { method: 'POST' }),
  mqttPublish: () => request<MqttStatus>('/mqtt/publish', { method: 'POST' }),

  search: (query: SearchQuery) => {
    const params = new URLSearchParams();
    params.set('q', query.q);
    if (query.account) params.set('account', query.account);
    // Folder paths may contain anything, so they are newline separated.
    if (query.folders && query.folders.length > 0) params.set('folders', query.folders.join('\n'));
    if (query.from) params.set('from', query.from);
    if (query.to) params.set('to', query.to);
    if (query.field && query.field !== 'all') params.set('field', query.field);
    if (query.sort) params.set('sort', query.sort);
    if (query.dateFrom) params.set('dateFrom', query.dateFrom);
    if (query.dateTo) params.set('dateTo', query.dateTo);
    if (query.withAttachments) params.set('attachments', '1');
    if (query.unreadOnly) params.set('unread', '1');
    if (query.flaggedOnly) params.set('flagged', '1');
    if (query.includeDeleted) params.set('deleted', '1');
    if (query.minSize) params.set('minSize', String(query.minSize));
    if (query.maxSize) params.set('maxSize', String(query.maxSize));
    params.set('limit', String(query.limit ?? 50));
    params.set('offset', String(query.offset ?? 0));
    return request<SearchResult>(`/search?${params.toString()}`);
  },
  message: (accountId: string, messageId: number) =>
    request<MessageContent>(`/accounts/${accountId}/messages/${messageId}`),
  openMessage: (accountId: string, messageId: number) =>
    request<{ opened: boolean }>(`/accounts/${accountId}/messages/${messageId}/open`, { method: 'POST' }),

  restoreMappings: (body: { accountId: string; target: RestoreTarget }) =>
    request<{ mappings: Array<{ source: string; target: string }>; targetFolders: string[] }>(
      '/restore/mappings',
      { method: 'POST', body: JSON.stringify(body) },
    ),
  startRestore: (body: {
    accountId: string;
    target: RestoreTarget;
    mappings: Array<{ source: string; target: string }>;
    selection: {
      query: string;
      folders: string[];
      dateFrom: string | null;
      dateTo: string | null;
      from: string | null;
      withAttachments: boolean;
    };
    skipExisting: boolean;
    restoreFlags: boolean;
  }) => request<{ started: boolean }>('/restore', { method: 'POST', body: JSON.stringify(body) }),
  cancelRestore: () => request<{ cancelled: boolean }>('/restore/cancel', { method: 'POST' }),

  migrationState: () =>
    request<{ running: boolean; progress: MigrationProgress | null }>('/archive/migration'),
  startMigration: (direction: 'encrypt' | 'decrypt') =>
    request<{ started: boolean }>('/archive/migration', {
      method: 'POST',
      body: JSON.stringify({ direction }),
    }),
  cancelMigration: () =>
    request<{ cancelled: boolean }>('/archive/migration/cancel', { method: 'POST' }),

  exports: () =>
    request<{ pdfAvailable: boolean; bundles: Array<{ bundleId: string; fileName: string; size: number }> }>(
      '/exports',
    ),
  startExportBundle: (body: {
    format: 'eml-zip' | 'mbox' | 'pdf-zip';
    q: string;
    account?: string | undefined;
    folders?: string[];
    from?: string | undefined;
    to?: string | undefined;
    field?: SearchField | undefined;
    dateFrom?: string | undefined;
    dateTo?: string | undefined;
    withAttachments?: boolean;
    unreadOnly?: boolean | undefined;
    flaggedOnly?: boolean | undefined;
    minSize?: number | undefined;
    maxSize?: number | undefined;
  }) => request<{ bundleId: string }>('/exports', { method: 'POST', body: JSON.stringify(body) }),
  cancelExportBundle: (bundleId: string) =>
    request<{ cancelled: boolean }>(`/exports/${bundleId}/cancel`, { method: 'POST' }),

  startIndex: (id: string) => request<{ started: boolean }>(`/accounts/${id}/index`, { method: 'POST' }),
  cancelIndex: (id: string) =>
    request<{ cancelled: boolean }>(`/accounts/${id}/index/cancel`, { method: 'POST' }),
  resetIndex: (id: string) => request<{ ok: true }>(`/accounts/${id}/index/reset`, { method: 'POST' }),

  attachments: (id: string) => request<AttachmentState>(`/accounts/${id}/attachments`),
  updateAttachments: (id: string, patch: Partial<AttachmentSettings>) =>
    request<AttachmentSettings>(`/accounts/${id}/attachments`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  startExport: (id: string) =>
    request<{ started: boolean }>(`/accounts/${id}/attachments/export`, { method: 'POST' }),
  cancelExport: (id: string) =>
    request<{ cancelled: boolean }>(`/accounts/${id}/attachments/export/cancel`, { method: 'POST' }),
  resetExport: (id: string) =>
    request<{ ok: true }>(`/accounts/${id}/attachments/reset`, { method: 'POST' }),

  recentRuns: (limit = 10) => request<Array<Record<string, unknown>>>(`/runs?limit=${limit}`),

  logs: (limit = 300) => request<LogEntry[]>(`/logs?limit=${limit}`),
};

/** Websocket URL for the live event stream of the active connection. */
export function eventsUrl(): string {
  const url = connection.url
    ? new URL('/api/events', connection.url)
    : new URL('api/events', window.location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  if (token) url.searchParams.set('token', token);
  return url.toString();
}

/** Builds a download link that carries the token, for plain <a download>. */
export function downloadUrl(path: string): string {
  const base = apiBase();
  const separator = path.includes('?') ? '&' : '?';
  return token ? `${base}${path}${separator}token=${encodeURIComponent(token)}` : `${base}${path}`;
}

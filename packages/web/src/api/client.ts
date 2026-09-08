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
  PublicAccount,
  SearchResult,
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
  PublicAccount,
  SearchResult,
};

export interface SearchQuery {
  q: string;
  account?: string | undefined;
  folders?: string[];
  from?: string | undefined;
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
  withAttachments?: boolean;
  limit?: number;
  offset?: number;
}

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
}

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

let token: string | null = readInitialToken();

export function setToken(value: string | null): void {
  token = value;
  if (value) sessionStorage.setItem(TOKEN_KEY, value);
  else sessionStorage.removeItem(TOKEN_KEY);
}

export function getToken(): string | null {
  return token;
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

  const response = await fetch(`api${path}`, { ...init, headers });
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

  folders: (id: string, withCounts: boolean) =>
    request<FolderTreeNode[]>(`/accounts/${id}/folders${withCounts ? '?counts=1' : ''}`),
  saveFolders: (id: string, folders: string[]) =>
    request<{ ok: true }>(`/accounts/${id}/folders`, { method: 'PUT', body: JSON.stringify({ folders }) }),

  startSync: (id: string) => request<{ started: boolean }>(`/accounts/${id}/sync`, { method: 'POST' }),
  cancelSync: (id: string) =>
    request<{ cancelled: boolean }>(`/accounts/${id}/sync/cancel`, { method: 'POST' }),

  search: (query: SearchQuery) => {
    const params = new URLSearchParams();
    params.set('q', query.q);
    if (query.account) params.set('account', query.account);
    // Folder paths may contain anything, so they are newline separated.
    if (query.folders && query.folders.length > 0) params.set('folders', query.folders.join('\n'));
    if (query.from) params.set('from', query.from);
    if (query.dateFrom) params.set('dateFrom', query.dateFrom);
    if (query.dateTo) params.set('dateTo', query.dateTo);
    if (query.withAttachments) params.set('attachments', '1');
    params.set('limit', String(query.limit ?? 50));
    params.set('offset', String(query.offset ?? 0));
    return request<SearchResult>(`/search?${params.toString()}`);
  },
  message: (accountId: string, messageId: number) =>
    request<MessageContent>(`/accounts/${accountId}/messages/${messageId}`),
  openMessage: (accountId: string, messageId: number) =>
    request<{ opened: boolean }>(`/accounts/${accountId}/messages/${messageId}/open`, { method: 'POST' }),

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

/** Websocket URL for the live event stream, relative to the current page. */
export function eventsUrl(): string {
  const url = new URL('api/events', window.location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  if (token) url.searchParams.set('token', token);
  return url.toString();
}

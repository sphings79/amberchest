/**
 * Where the interface is talking to.
 *
 * The desktop app normally drives its own local server, but it can just as
 * well operate a container somewhere else - the API is the same either way.
 * Connections are remembered; their tokens are not, so the web password is
 * asked for once per session.
 */

export interface Connection {
  id: string;
  name: string;
  /** Empty for the local server, otherwise the base URL of a remote one. */
  url: string;
}

/** The built-in connection: the server this page was loaded from. */
export const LOCAL_CONNECTION: Connection = { id: 'local', name: '', url: '' };

const CONNECTIONS_KEY = 'amberchest-connections';
const ACTIVE_KEY = 'amberchest-active-connection';
const TOKEN_PREFIX = 'amberchest-token:';

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function listConnections(): Connection[] {
  return readJson<Connection[]>(CONNECTIONS_KEY, []);
}

export function saveConnections(connections: Connection[]): void {
  localStorage.setItem(CONNECTIONS_KEY, JSON.stringify(connections));
}

export function getActiveConnectionId(): string {
  return localStorage.getItem(ACTIVE_KEY) ?? LOCAL_CONNECTION.id;
}

export function setActiveConnectionId(id: string): void {
  localStorage.setItem(ACTIVE_KEY, id);
}

export function getActiveConnection(): Connection {
  const id = getActiveConnectionId();
  if (id === LOCAL_CONNECTION.id) return LOCAL_CONNECTION;
  return listConnections().find((entry) => entry.id === id) ?? LOCAL_CONNECTION;
}

/**
 * Tokens live in sessionStorage on purpose: closing the window forgets them,
 * so a remote instance asks for its password again next time.
 */
export function getConnectionToken(id: string): string | null {
  return sessionStorage.getItem(TOKEN_PREFIX + id);
}

export function setConnectionToken(id: string, token: string | null): void {
  if (token) sessionStorage.setItem(TOKEN_PREFIX + id, token);
  else sessionStorage.removeItem(TOKEN_PREFIX + id);
}

/** Normalises what someone typed into a base URL the client can use. */
export function normaliseUrl(input: string): string {
  const trimmed = input.trim();
  if (trimmed === '') return '';
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  return withScheme.replace(/\/+$/, '');
}

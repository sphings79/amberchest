import { ImapFlow } from 'imapflow';
import type { Account, RemoteFolder } from '../types.js';
import { messageFingerprint } from '../util/hash.js';

export interface ImapConnectionOptions {
  host: string;
  port: number;
  security: 'tls' | 'starttls' | 'none';
  rejectUnauthorized: boolean;
  username: string;
  password: string;
  /** Set instead of the password for an OAuth account. */
  accessToken?: string | undefined;
}

export function connectionOptionsFromAccount(account: Account): ImapConnectionOptions {
  return {
    host: account.host,
    port: account.port,
    security: account.security,
    rejectUnauthorized: account.rejectUnauthorized,
    username: account.username,
    password: account.password,
    // A stale token is refreshed before this is called; see app.connect().
    ...(account.authType === 'oauth' ? { accessToken: account.oauth?.accessToken } : {}),
  };
}

/**
 * Creates a client. Nothing here ever writes to the mailbox: folders are only
 * ever opened read-only and message bodies are fetched with BODY.PEEK, so the
 * \Seen flag stays untouched.
 */
export function createClient(options: ImapConnectionOptions): ImapFlow {
  return new ImapFlow({
    host: options.host,
    port: options.port,
    secure: options.security === 'tls',
    doSTARTTLS: options.security === 'starttls',
    // The library picks OAUTHBEARER or XOAUTH2 by itself, depending on what
    // the server announces.
    auth: options.accessToken
      ? { user: options.username, accessToken: options.accessToken }
      : { user: options.username, pass: options.password },
    tls: { rejectUnauthorized: options.rejectUnauthorized },
    logger: false,
    // We drive the connection ourselves; IDLE would only get in the way.
    disableAutoIdle: true,
    connectionTimeout: 30_000,
    greetingTimeout: 20_000,
    socketTimeout: 15 * 60_000,
    clientInfo: { name: 'Mail Archiver', vendor: 'sphings79' },
  });
}

export async function withConnection<T>(
  options: ImapConnectionOptions,
  fn: (client: ImapFlow) => Promise<T>,
): Promise<T> {
  const client = createClient(options);
  await client.connect();
  try {
    return await fn(client);
  } finally {
    try {
      await client.logout();
    } catch {
      client.close();
    }
  }
}

export interface ConnectionTestResult {
  ok: boolean;
  error?: string;
  capabilities?: string[];
  folderCount?: number;
}

/** Turns the more common IMAP failures into something a human can act on. */
export function describeImapError(error: unknown): string {
  const err = error as { code?: string; authenticationFailed?: boolean; responseText?: string; message?: string };
  if (err?.authenticationFailed) return 'Authentication failed - check user name and password';
  switch (err?.code) {
    case 'ENOTFOUND':
      return 'Server not found - check the host name';
    case 'ECONNREFUSED':
      return 'Connection refused - check host and port';
    case 'ETIMEDOUT':
      return 'Connection timed out';
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
    case 'SELF_SIGNED_CERT_IN_CHAIN':
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
      return 'Certificate could not be verified - enable "accept self-signed certificate" if this is expected';
    default:
      return err?.responseText ?? err?.message ?? String(error);
  }
}

export async function testConnection(options: ImapConnectionOptions): Promise<ConnectionTestResult> {
  try {
    return await withConnection(options, async (client) => {
      const folders = await client.list({ listOnly: true });
      const capabilities = [...client.capabilities.keys()];
      return { ok: true, capabilities, folderCount: folders.length };
    });
  } catch (error) {
    return { ok: false, error: describeImapError(error) };
  }
}

export interface ListFoldersOptions {
  /** Ask the server for message counts; costs one STATUS per folder. */
  withCounts?: boolean;
}

export async function listRemoteFolders(
  client: ImapFlow,
  options: ListFoldersOptions = {},
): Promise<RemoteFolder[]> {
  const listing = await client.list(
    options.withCounts ? { statusQuery: { messages: true } } : undefined,
  );

  return listing.map((entry) => ({
    path: entry.path,
    name: entry.name,
    delimiter: entry.delimiter ?? '',
    specialUse: entry.specialUse ?? null,
    noSelect: entry.flags.has('\\Noselect') || entry.flags.has('\\NonExistent'),
    messageCount: entry.status?.messages ?? null,
    sizeBytes: null,
  }));
}

export interface MailboxState {
  uidValidity: number;
  uidNext: number;
  exists: number;
}

export async function openFolderReadOnly(client: ImapFlow, path: string): Promise<MailboxState> {
  const mailbox = await client.mailboxOpen(path, { readOnly: true });
  return {
    uidValidity: Number(mailbox.uidValidity),
    uidNext: mailbox.uidNext,
    exists: mailbox.exists,
  };
}

/** Metadata of one server side message, gathered without downloading a body. */
export interface ScannedMessage {
  uid: number;
  flags: string[];
  internalDate: Date;
  size: number;
  messageId: string | null;
  subject: string | null;
  fromAddress: string | null;
  toAddress: string | null;
  fingerprint: string;
}

function firstAddress(list: Array<{ name?: string; address?: string }> | undefined): string | null {
  const entry = list?.[0];
  if (!entry) return null;
  return entry.address ?? entry.name ?? null;
}

function toDate(value: Date | string | undefined): Date {
  if (value instanceof Date) return value;
  if (typeof value === 'string') return new Date(value);
  return new Date(0);
}

/** Compacts a UID list into an IMAP sequence string such as `1:5,9,12:14`. */
export function toSequenceString(uids: number[]): string {
  if (uids.length === 0) return '';
  const sorted = [...uids].sort((a, b) => a - b);
  const parts: string[] = [];
  let start = sorted[0] as number;
  let previous = start;
  for (let index = 1; index < sorted.length; index += 1) {
    const uid = sorted[index] as number;
    if (uid === previous + 1) {
      previous = uid;
      continue;
    }
    parts.push(start === previous ? String(start) : `${start}:${previous}`);
    start = uid;
    previous = uid;
  }
  parts.push(start === previous ? String(start) : `${start}:${previous}`);
  return parts.join(',');
}

export interface ScanOptions {
  /** Only look at messages received at or after this date. */
  since?: Date | null;
  onProgress?: (done: number, total: number) => void;
}

/**
 * Reads UID, flags, size and envelope of every message in the open folder.
 *
 * This is the cheap pass that drives the diff: it tells us which messages are
 * new, which vanished and which only changed their flags - and it produces the
 * fingerprints needed to recognise a message that merely moved.
 */
export async function scanFolder(client: ImapFlow, options: ScanOptions = {}): Promise<ScannedMessage[]> {
  let range = '1:*';

  if (options.since) {
    const found = await client.search({ since: options.since }, { uid: true });
    if (!found || !Array.isArray(found) || found.length === 0) return [];
    range = toSequenceString(found);
  }

  const messages: ScannedMessage[] = [];
  const total = client.mailbox && typeof client.mailbox === 'object' ? client.mailbox.exists : 0;

  for await (const message of client.fetch(
    range,
    { uid: true, flags: true, internalDate: true, size: true, envelope: true },
    { uid: true },
  )) {
    const internalDate = toDate(message.internalDate);
    const envelope = message.envelope;
    const scanned: ScannedMessage = {
      uid: message.uid,
      flags: message.flags ? [...message.flags] : [],
      internalDate,
      size: message.size ?? 0,
      messageId: envelope?.messageId ?? null,
      subject: envelope?.subject ?? null,
      fromAddress: firstAddress(envelope?.from),
      toAddress: firstAddress(envelope?.to),
      fingerprint: '',
    };
    scanned.fingerprint = messageFingerprint({
      messageId: scanned.messageId,
      internalDate,
      fromAddress: scanned.fromAddress,
      subject: scanned.subject,
      size: scanned.size,
    });
    messages.push(scanned);
    options.onProgress?.(messages.length, total);
  }

  return messages;
}

/**
 * Downloads the raw RFC 5322 source of the given UIDs in batches.
 *
 * `source: true` compiles to BODY.PEEK[], so this never sets \Seen.
 */
export async function fetchSources(
  client: ImapFlow,
  uids: number[],
  batchSize: number,
  onMessage: (uid: number, source: Buffer, flags: string[]) => Promise<void> | void,
  shouldCancel?: () => boolean,
): Promise<void> {
  for (let index = 0; index < uids.length; index += batchSize) {
    if (shouldCancel?.()) return;
    const batch = uids.slice(index, index + batchSize);
    for await (const message of client.fetch(
      toSequenceString(batch),
      { uid: true, source: true, flags: true },
      { uid: true },
    )) {
      if (shouldCancel?.()) return;
      if (!message.source) continue;
      await onMessage(message.uid, message.source, message.flags ? [...message.flags] : []);
    }
  }
}

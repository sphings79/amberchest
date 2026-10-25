import { ImapFlow } from 'imapflow';
import type { Account, RemoteFolder } from '../types.js';
import { sleep } from '../util/concurrency.js';
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
    clientInfo: { name: 'AmberChest', vendor: 'sphings79' },
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
  const err = error as {
    code?: string;
    authenticationFailed?: boolean;
    responseText?: string;
    message?: string;
    reason?: string;
    command?: string;
  };
  if (err?.authenticationFailed) {
    // The text the server sent often says more than a wrong password, such as a
    // lock after too many logins.
    const said = err.responseText?.trim();
    return said
      ? `Authentication failed - check user name and password (server said: ${said})`
      : 'Authentication failed - check user name and password';
  }
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
    case 'NoConnection': {
      // The library only says that the connection was gone. Why it went is in
      // the server's BYE text and in the command that was running.
      const parts: string[] = [];
      if (err.reason) parts.push(`server said: ${err.reason}`);
      if (err.command) parts.push(`during ${err.command}`);
      return parts.length > 0
        ? `${err.message ?? 'Connection not available'} (${parts.join(', ')})`
        : (err.message ?? 'Connection not available');
    }
    default:
      return err?.responseText ?? err?.message ?? String(error);
  }
}

/**
 * Why a run should pause instead of fail, or null when it should fail.
 *
 * A host that closes the connection in the middle of a run, or says it has
 * had enough ("Account exceeded command or bandwidth limits"), is not broken:
 * what was downloaded is kept and a later run carries on. A wrong password or
 * a missing server is a different matter and stays a failure.
 */
export function serverPauseReason(error: unknown): string | null {
  const err = error as { code?: string; reason?: string; responseText?: string; message?: string };
  const text = `${err?.reason ?? ''} ${err?.responseText ?? ''}`;
  if (err?.code === 'NoConnection') return describeImapError(error);
  if (/limit|bandwidth|too many|throttl|rate/i.test(text)) return describeImapError(error);
  return null;
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
  /**
   * UIDs asked for per command. Zero asks for the whole folder in one, which
   * is what a host that is not touchy about it is happiest with.
   */
  blockSize?: number;
  /** Pause between two blocks, in milliseconds. */
  pauseMs?: number;
  shouldCancel?: () => boolean;
  /** Called after each block, for the log. */
  onBlock?: (block: {
    index: number;
    blocks: number;
    range: string;
    messages: number;
    ms: number;
    kind: 'envelope' | 'flags';
  }) => void;
  /**
   * Messages the archive already has, by UID.
   *
   * For those the envelope is not asked for again - it cannot change under a
   * UID - only their flags. What the folder holds is then read with one cheap
   * `UID SEARCH`, and the heavy command is left for the UIDs that are new.
   */
  known?: Map<number, KnownMessage>;
  /** UIDs per command when only flags are asked for; they are cheap. */
  flagBlockSize?: number;
}

/** What the archive remembers of a message, enough to stand in for its envelope. */
export interface KnownMessage {
  messageId: string | null;
  subject: string | null;
  fromAddress: string | null;
  toAddress: string | null;
  internalDate: Date;
  size: number;
  fingerprint: string;
}

/** The UID ranges one scan is made of, as IMAP sequence strings. */
function scanRanges(uids: number[] | null, uidNext: number, blockSize: number): string[] {
  if (uids) {
    if (blockSize <= 0 || uids.length <= blockSize) return [toSequenceString(uids)];
    const sorted = [...uids].sort((a, b) => a - b);
    const ranges: string[] = [];
    for (let index = 0; index < sorted.length; index += blockSize) {
      ranges.push(toSequenceString(sorted.slice(index, index + blockSize)));
    }
    return ranges;
  }
  // The server may not tell where the UIDs end; then there is only one block.
  if (blockSize <= 0 || !Number.isFinite(uidNext) || uidNext <= blockSize + 1) return ['1:*'];
  const ranges: string[] = [];
  for (let start = 1; start < uidNext; start += blockSize) {
    ranges.push(`${start}:${Math.min(start + blockSize - 1, uidNext - 1)}`);
  }
  return ranges;
}

/**
 * Reads UID, flags, size and envelope of every message in the open folder.
 *
 * This is the cheap pass that drives the diff: it tells us which messages are
 * new, which vanished and which only changed their flags - and it produces the
 * fingerprints needed to recognise a message that merely moved.
 *
 * In blocks of UIDs with a pause between them, when asked: one command for a
 * whole folder of tens of thousands of messages is what some hosts answer
 * with a closed connection.
 */
export async function scanFolder(client: ImapFlow, options: ScanOptions = {}): Promise<ScannedMessage[]> {
  const known = options.known && options.known.size > 0 ? options.known : null;
  const mailbox = client.mailbox && typeof client.mailbox === 'object' ? client.mailbox : null;
  const total = mailbox ? mailbox.exists : 0;
  const uidNext = mailbox ? Number(mailbox.uidNext) : 0;
  const blockSize = options.blockSize ?? 0;

  let uids: number[] | null = null;
  if (options.since || known) {
    const found = await client.search(options.since ? { since: options.since } : { all: true }, {
      uid: true,
    });
    if (!found || !Array.isArray(found) || found.length === 0) return [];
    uids = found;
  }

  const messages: ScannedMessage[] = [];
  const fetchEnvelopes = async (ranges: string[]): Promise<boolean> => {
    for (const [index, range] of ranges.entries()) {
      if (options.shouldCancel?.()) return false;
      if (index > 0 && (options.pauseMs ?? 0) > 0) await sleep(options.pauseMs as number);

      const startedAt = Date.now();
      const before = messages.length;
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
      options.onBlock?.({
        index: index + 1,
        blocks: ranges.length,
        range,
        messages: messages.length - before,
        ms: Date.now() - startedAt,
        kind: 'envelope',
      });
    }
    return true;
  };

  if (!known || !uids) {
    await fetchEnvelopes(scanRanges(uids, uidNext, blockSize));
    return messages;
  }

  // New UIDs get their envelope; the ones already archived only their flags.
  const sorted = [...uids].sort((a, b) => a - b);
  const fresh = sorted.filter((uid) => !known.has(uid));
  const archived = sorted.filter((uid) => known.has(uid));

  if (fresh.length > 0 && !(await fetchEnvelopes(scanRanges(fresh, 0, blockSize)))) return messages;

  const flagBlock = options.flagBlockSize ?? FLAG_BLOCK_SIZE;
  const flagRanges = scanRanges(archived, 0, flagBlock);
  for (const [index, range] of flagRanges.entries()) {
    if (options.shouldCancel?.()) return messages;
    if (index > 0 && (options.pauseMs ?? 0) > 0) await sleep(options.pauseMs as number);

    const startedAt = Date.now();
    const before = messages.length;
    for await (const message of client.fetch(range, { uid: true, flags: true }, { uid: true })) {
      const stored = known.get(message.uid);
      if (!stored) continue;
      messages.push({
        uid: message.uid,
        flags: message.flags ? [...message.flags] : [],
        internalDate: stored.internalDate,
        size: stored.size,
        messageId: stored.messageId,
        subject: stored.subject,
        fromAddress: stored.fromAddress,
        toAddress: stored.toAddress,
        fingerprint: stored.fingerprint,
      });
      options.onProgress?.(messages.length, total);
    }
    options.onBlock?.({
      index: index + 1,
      blocks: flagRanges.length,
      range,
      messages: messages.length - before,
      ms: Date.now() - startedAt,
      kind: 'flags',
    });
  }

  return messages.sort((a, b) => a.uid - b.uid);
}

/** Flags are small, so far more UIDs fit in one command than envelopes do. */
const FLAG_BLOCK_SIZE = 5000;

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

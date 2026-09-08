import { createHash, randomBytes } from 'node:crypto';
import type { OAuthProvider } from './providers.js';
import { OAuthError, type OAuthTokens } from './device.js';

/**
 * The authorization code flow with PKCE, for providers without a device flow.
 *
 * Whoever catches the redirect - a listener on the desktop, the callback route
 * of the container, or the user copying the address out of the browser - only
 * ever passes the code along. The exchange happens on the machine that will
 * store the token, so the token itself never travels.
 */
export interface PendingAuthorization {
  state: string;
  verifier: string;
  redirectUri: string;
  url: string;
}

function base64url(buffer: Buffer): string {
  return buffer.toString('base64url');
}

/** Builds the URL the user has to open, plus what is needed to finish. */
export function buildAuthorization(
  provider: OAuthProvider,
  clientId: string,
  redirectUri: string,
  options: { extraScopes?: string[]; loginHint?: string } = {},
): PendingAuthorization {
  const verifier = base64url(randomBytes(64));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  const state = base64url(randomBytes(24));

  const url = new URL(provider.authorizationEndpoint);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', [...provider.scopes, ...(options.extraScopes ?? [])].join(' '));
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  // Without these two Google hands out a refresh token on the first consent
  // only, and the second account of the same person would never get one.
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  // Preselects the right mailbox for someone signed into several accounts at
  // once - otherwise it is easy to consent with the wrong one, and the token
  // then belongs to a mailbox nobody wanted to archive.
  if (options.loginHint) url.searchParams.set('login_hint', options.loginHint);

  return { state, verifier, redirectUri, url: url.toString() };
}

/**
 * Pulls the code out of whatever the user pasted.
 *
 * People paste the whole address they landed on, sometimes just the code, and
 * sometimes an address that carries an error instead.
 */
export function codeFromInput(input: string): { code: string; state: string | null } {
  const trimmed = input.trim();
  if (!trimmed) throw new OAuthError('invalid_request', 'Nothing to read a code from');

  if (!/^https?:\/\//i.test(trimmed)) return { code: trimmed, state: null };

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new OAuthError('invalid_request', 'That is not an address');
  }

  const error = url.searchParams.get('error');
  if (error) throw new OAuthError(error, url.searchParams.get('error_description') ?? error);

  const code = url.searchParams.get('code');
  if (!code) throw new OAuthError('invalid_request', 'The address carries no code');
  return { code, state: url.searchParams.get('state') };
}

/** Trades the code for tokens. */
export async function exchangeCode(
  provider: OAuthProvider,
  clientId: string,
  pending: PendingAuthorization,
  code: string,
  clientSecret?: string,
): Promise<OAuthTokens> {
  const response = await fetch(provider.tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      redirect_uri: pending.redirectUri,
      code_verifier: pending.verifier,
      ...(clientSecret ? { client_secret: clientSecret } : {}),
    }).toString(),
  });

  const text = await response.text();
  let payload: Record<string, unknown>;
  try {
    payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    throw new OAuthError('invalid_response', 'The token endpoint answered with something odd');
  }

  if (payload.error) {
    throw new OAuthError(
      String(payload.error),
      String(payload.error_description ?? payload.error),
    );
  }
  if (!response.ok || !payload.access_token) {
    throw new OAuthError('http_error', `The token endpoint answered with HTTP ${response.status}`);
  }

  return {
    accessToken: String(payload.access_token),
    refreshToken: payload.refresh_token ? String(payload.refresh_token) : null,
    expiresAt: Date.now() + ((Number(payload.expires_in) || 3600) - 60) * 1000,
    scope: payload.scope ? String(payload.scope) : null,
  };
}

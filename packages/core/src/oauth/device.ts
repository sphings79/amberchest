import { logger } from '../util/logger.js';
import type { OAuthProvider } from './providers.js';

/**
 * The device authorization grant, RFC 8628.
 *
 * The application asks for a code, shows it to the user, and the user types it
 * into a browser somewhere else - on a phone, on another machine. Nothing has
 * to be reachable from outside, which is exactly what a container behind a
 * reverse proxy needs.
 */
export interface DeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  /** Some providers offer a link that already contains the code. */
  verificationUriComplete: string | null;
  expiresAt: number;
  intervalSeconds: number;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string | null;
  /** Epoch milliseconds; refreshed a little before this. */
  expiresAt: number;
  scope: string | null;
}

export class OAuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'OAuthError';
  }
}

interface DeviceResponse {
  device_code: string;
  user_code: string;
  verification_uri?: string;
  verification_url?: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval?: number;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

async function post(url: string, body: Record<string, string>): Promise<unknown> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });

  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    throw new OAuthError('invalid_response', `${url} answered with something that is not JSON`);
  }

  const error = (payload as TokenResponse | null)?.error;
  if (error) {
    // A pending authorisation is a normal answer, not a failure; the caller
    // decides what to do with it.
    throw new OAuthError(error, (payload as TokenResponse).error_description ?? error);
  }
  if (!response.ok) {
    throw new OAuthError('http_error', `${url} answered with HTTP ${response.status}`);
  }
  return payload;
}

/** Asks the provider for a code the user can type in somewhere else. */
export async function startDeviceFlow(
  provider: OAuthProvider,
  clientId: string,
  extraScopes: string[] = [],
): Promise<DeviceCode> {
  if (!provider.deviceEndpoint) {
    throw new OAuthError('unsupported', `${provider.name} has no device flow`);
  }

  const payload = (await post(provider.deviceEndpoint, {
    client_id: clientId,
    scope: [...provider.scopes, ...extraScopes].join(' '),
  })) as DeviceResponse;

  const verification = payload.verification_uri ?? payload.verification_url ?? '';
  logger.info(`OAuth device flow started for ${provider.name}, code ${payload.user_code}`);

  return {
    deviceCode: payload.device_code,
    userCode: payload.user_code,
    verificationUri: verification,
    verificationUriComplete: payload.verification_uri_complete ?? null,
    expiresAt: Date.now() + payload.expires_in * 1000,
    // RFC 8628 says five seconds when the provider does not say otherwise.
    intervalSeconds: payload.interval ?? 5,
  };
}

/**
 * Asks once whether the user is done.
 *
 * Returns null while the authorisation is still pending, which is the answer
 * the endpoint gives for most of the wait.
 */
export async function pollDeviceFlow(
  provider: OAuthProvider,
  clientId: string,
  deviceCode: string,
  clientSecret?: string,
): Promise<OAuthTokens | null> {
  try {
    const payload = (await post(provider.tokenEndpoint, {
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      client_id: clientId,
      device_code: deviceCode,
      ...(clientSecret ? { client_secret: clientSecret } : {}),
    })) as TokenResponse;

    return toTokens(payload);
  } catch (error) {
    if (!(error instanceof OAuthError)) throw error;
    // The three answers that mean "keep waiting" rather than "give up".
    if (error.code === 'authorization_pending') return null;
    if (error.code === 'slow_down') return null;
    throw error;
  }
}

/** Trades a refresh token for a fresh access token. */
export async function refreshTokens(
  provider: OAuthProvider,
  clientId: string,
  refreshToken: string,
  clientSecret?: string,
): Promise<OAuthTokens> {
  const payload = (await post(provider.tokenEndpoint, {
    grant_type: 'refresh_token',
    client_id: clientId,
    refresh_token: refreshToken,
    ...(clientSecret ? { client_secret: clientSecret } : {}),
  })) as TokenResponse;

  const tokens = toTokens(payload);
  // Providers that rotate refresh tokens send a new one; the others expect the
  // old one to be kept.
  return { ...tokens, refreshToken: tokens.refreshToken ?? refreshToken };
}

function toTokens(payload: TokenResponse): OAuthTokens {
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? null,
    // A minute of slack, so a token never expires between the check and the
    // connection that uses it.
    expiresAt: Date.now() + ((payload.expires_in ?? 3600) - 60) * 1000,
    scope: payload.scope ?? null,
  };
}

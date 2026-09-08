import { randomBytes } from 'node:crypto';
import type { ConfigStore } from '../config/store.js';
import type { Account, OAuthClient, OAuthSettings } from '../types.js';
import { logger } from '../util/logger.js';
import {
  buildAuthorization,
  codeFromInput,
  exchangeCode,
  type PendingAuthorization,
} from './code.js';
import {
  OAuthError,
  pollDeviceFlow,
  refreshTokens,
  startDeviceFlow,
  type DeviceCode,
  type OAuthTokens,
} from './device.js';
import { resolveProvider, type OAuthProvider, type OAuthProviderId } from './providers.js';

/** How the browser gets back to us, and therefore what has to be registered. */
export type RedirectMode = 'loopback' | 'public';

export interface StartedAuthorization {
  /** The address the user has to open. */
  url: string;
  state: string;
  redirectUri: string;
}

export interface DeviceStatus {
  code: DeviceCode | null;
  connected: boolean;
  error: string | null;
}

interface Session extends PendingAuthorization {
  accountId: string;
  provider: OAuthProviderId;
  startedAt: number;
}

interface DeviceSession {
  accountId: string;
  provider: OAuthProviderId;
  code: DeviceCode;
  error: string | null;
  connected: boolean;
}

/** Sessions older than this are forgotten; the codes are dead by then anyway. */
const SESSION_LIFETIME = 20 * 60 * 1000;

/**
 * Runs the OAuth conversations and puts the result into the configuration.
 *
 * Both flows end in the same place: the server exchanges the code or the
 * device code itself and stores the refresh token with the account, so an
 * unattended backup can keep going without anybody logging in again.
 */
export class OAuthManager {
  private readonly sessions = new Map<string, Session>();
  private readonly devices = new Map<string, DeviceSession>();

  constructor(private readonly config: ConfigStore) {}

  private settings(): OAuthSettings {
    return this.config.getSettings().oauth;
  }

  private clientFor(id: OAuthProviderId): OAuthClient {
    return this.settings()[id];
  }

  /** The provider, with a custom one filled in from the settings. */
  provider(id: OAuthProviderId): OAuthProvider {
    const client = this.clientFor(id);
    if (id !== 'custom') return resolveProvider(id);
    return resolveProvider('custom', {
      authorizationEndpoint: client.authorizationEndpoint,
      tokenEndpoint: client.tokenEndpoint,
      deviceEndpoint: client.deviceEndpoint || null,
      scopes: client.scopes,
      imapHost: client.imapHost,
      clientSecretUsed: client.clientSecret.length > 0,
    });
  }

  private requireClient(id: OAuthProviderId): OAuthClient {
    const client = this.clientFor(id);
    if (!client.clientId) {
      throw new OAuthError('no_client', `No client id is configured for ${id}`);
    }
    return client;
  }

  private secretFor(id: OAuthProviderId): string | undefined {
    const secret = this.clientFor(id).clientSecret;
    return secret ? secret : undefined;
  }

  // ------------------------------------------------------------- device flow

  /** Starts the device flow and remembers it for the polling that follows. */
  async startDevice(accountId: string, providerId: OAuthProviderId): Promise<DeviceCode> {
    const client = this.requireClient(providerId);
    const provider = this.provider(providerId);

    const code = await startDeviceFlow(provider, client.clientId);
    this.devices.set(accountId, {
      accountId,
      provider: providerId,
      code,
      error: null,
      connected: false,
    });
    return code;
  }

  /** Asks once whether the user has confirmed; stores the tokens if so. */
  async pollDevice(accountId: string): Promise<DeviceStatus> {
    const session = this.devices.get(accountId);
    if (!session) return { code: null, connected: false, error: null };
    if (session.connected || session.error) {
      return { code: session.code, connected: session.connected, error: session.error };
    }

    if (Date.now() > session.code.expiresAt) {
      session.error = 'The code expired before it was confirmed';
      return { code: session.code, connected: false, error: session.error };
    }

    try {
      const tokens = await pollDeviceFlow(
        this.provider(session.provider),
        this.requireClient(session.provider).clientId,
        session.code.deviceCode,
        this.secretFor(session.provider),
      );
      if (!tokens) return { code: session.code, connected: false, error: null };

      await this.store(accountId, session.provider, tokens);
      session.connected = true;
      return { code: session.code, connected: true, error: null };
    } catch (error) {
      session.error = (error as Error).message;
      return { code: session.code, connected: false, error: session.error };
    }
  }

  // --------------------------------------------------------------- code flow

  /**
   * Builds the authorization URL.
   *
   * The redirect address decides what the user has to register: a loopback
   * address belongs to a desktop client, a public one to a web client.
   */
  startAuthorization(
    accountId: string,
    providerId: OAuthProviderId,
    options: { mode?: RedirectMode; loopbackPort?: number } = {},
  ): StartedAuthorization {
    const client = this.requireClient(providerId);
    const settings = this.settings();
    const mode = options.mode ?? settings.redirectMode;

    let redirectUri: string;
    if (mode === 'public') {
      if (!settings.publicRedirectUri) {
        throw new OAuthError('no_redirect', 'No public redirect address is configured');
      }
      redirectUri = settings.publicRedirectUri;
    } else {
      // Any loopback port is allowed for a desktop client, and nothing has to
      // listen on it when the user copies the address back by hand.
      redirectUri = `http://127.0.0.1:${options.loopbackPort ?? 0}`;
    }

    const pending = buildAuthorization(this.provider(providerId), client.clientId, redirectUri);
    this.sessions.set(pending.state, {
      ...pending,
      accountId,
      provider: providerId,
      startedAt: Date.now(),
    });
    this.sweep();
    return { url: pending.url, state: pending.state, redirectUri };
  }

  /**
   * Finishes a started authorization.
   *
   * `input` is either the code or the whole address the browser ended up on,
   * because that is what people have in their clipboard.
   */
  async completeAuthorization(input: string, state?: string): Promise<string> {
    const parsed = codeFromInput(input);
    const key = state ?? parsed.state;
    if (!key) throw new OAuthError('no_state', 'Cannot tell which authorization this belongs to');

    const session = this.sessions.get(key);
    if (!session) throw new OAuthError('unknown_state', 'That authorization is unknown or expired');

    const tokens = await exchangeCode(
      this.provider(session.provider),
      this.requireClient(session.provider).clientId,
      session,
      parsed.code,
      this.secretFor(session.provider),
    );

    if (!tokens.refreshToken) {
      // Without one every backup would need a person at the keyboard.
      throw new OAuthError('no_refresh_token', 'The provider sent no refresh token');
    }

    await this.store(session.accountId, session.provider, tokens);
    this.sessions.delete(key);
    return session.accountId;
  }

  // ------------------------------------------------------------------ tokens

  /** A valid access token for this account, refreshed when it is due. */
  async accessToken(account: Account): Promise<string> {
    const oauth = account.oauth;
    if (!oauth) throw new OAuthError('not_connected', `${account.name} has no OAuth connection`);
    if (oauth.accessToken && oauth.expiresAt > Date.now()) return oauth.accessToken;
    if (!oauth.refreshToken) {
      throw new OAuthError('not_connected', `${account.name} has to be connected again`);
    }

    logger.debug(`Refreshing the OAuth token of ${account.name}`);
    const tokens = await refreshTokens(
      this.provider(oauth.provider),
      this.requireClient(oauth.provider).clientId,
      oauth.refreshToken,
      this.secretFor(oauth.provider),
    );
    await this.store(account.id, oauth.provider, tokens);
    return tokens.accessToken;
  }

  private async store(
    accountId: string,
    provider: OAuthProviderId,
    tokens: OAuthTokens,
  ): Promise<void> {
    await this.config.updateAccount(accountId, {
      authType: 'oauth',
      oauth: {
        provider,
        accessToken: tokens.accessToken,
        expiresAt: tokens.expiresAt,
        scope: tokens.scope ?? '',
        ...(tokens.refreshToken ? { refreshToken: tokens.refreshToken } : {}),
      },
    });
    logger.info(`OAuth token stored for account ${accountId}`);
  }

  /** Drops sessions nobody finished. */
  private sweep(): void {
    const deadline = Date.now() - SESSION_LIFETIME;
    for (const [key, session] of this.sessions) {
      if (session.startedAt < deadline) this.sessions.delete(key);
    }
  }

  /** A random port suggestion for a desktop listener. */
  static suggestLoopbackPort(): number {
    // 49152 and up is the ephemeral range; a fixed suggestion keeps the
    // registered redirect address stable for people who want one.
    return 49152 + (randomBytes(2).readUInt16BE(0) % 10_000);
  }
}

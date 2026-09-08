/**
 * The mail providers that speak OAuth, and how each of them wants to be asked.
 *
 * Every provider needs its own registered client. For a self hosted
 * application there is no way around that: a mailbox scope is as sensitive as
 * a permission gets, and neither Google nor Microsoft hands one to an
 * unverified client. The interface therefore asks for a client id, and the
 * documentation explains where to get one.
 */
export type OAuthProviderId = 'google' | 'microsoft' | 'custom';

export interface OAuthProvider {
  id: OAuthProviderId;
  name: string;
  /** Where the device flow starts; null when the provider has none. */
  deviceEndpoint: string | null;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  /** What to ask for; IMAP access plus a refresh token. */
  scopes: string[];
  /** Some providers hand out a secret even for "installed" clients. */
  clientSecretUsed: boolean;
  /** Default IMAP host and port, so the form can fill itself in. */
  imapHost: string;
  imapPort: number;
}

export const PROVIDERS: Record<Exclude<OAuthProviderId, 'custom'>, OAuthProvider> = {
  google: {
    id: 'google',
    name: 'Google',
    // Google supports the device flow, but not for mailbox scopes: the
    // documented list is limited to sign in, Drive and YouTube. Gmail
    // therefore has to go through the browser.
    deviceEndpoint: null,
    authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenEndpoint: 'https://oauth2.googleapis.com/token',
    scopes: ['https://mail.google.com/'],
    clientSecretUsed: true,
    imapHost: 'imap.gmail.com',
    imapPort: 993,
  },
  microsoft: {
    id: 'microsoft',
    name: 'Microsoft 365 / Outlook.com',
    deviceEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/devicecode',
    authorizationEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scopes: ['https://outlook.office.com/IMAP.AccessAsUser.All', 'offline_access'],
    clientSecretUsed: false,
    imapHost: 'outlook.office365.com',
    imapPort: 993,
  },
};

/** Resolves a provider, filling in what a custom one leaves to the user. */
export function resolveProvider(
  id: OAuthProviderId,
  custom?: Partial<OAuthProvider>,
): OAuthProvider {
  if (id !== 'custom') return PROVIDERS[id];
  return {
    id: 'custom',
    name: custom?.name ?? 'Custom',
    deviceEndpoint: custom?.deviceEndpoint ?? null,
    authorizationEndpoint: custom?.authorizationEndpoint ?? '',
    tokenEndpoint: custom?.tokenEndpoint ?? '',
    scopes: custom?.scopes ?? [],
    clientSecretUsed: custom?.clientSecretUsed ?? false,
    imapHost: custom?.imapHost ?? '',
    imapPort: custom?.imapPort ?? 993,
  };
}

/** Whether this provider can be connected without a browser redirect. */
export function supportsDeviceFlow(provider: OAuthProvider): boolean {
  return Boolean(provider.deviceEndpoint);
}

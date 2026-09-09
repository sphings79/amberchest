import type { AccountOverview } from '../app.js';

/**
 * Turns an account name into a topic segment.
 *
 * MQTT topics must not contain `+`, `#` or `/`, and Home Assistant is easier
 * to live with when the topic says which mailbox it belongs to. The account id
 * is the fallback for a name that is nothing but punctuation.
 */
export function accountSlug(overview: AccountOverview): string {
  const base = overview.account.name || overview.account.email;
  const slug = base
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug || overview.account.id.slice(0, 8);
}

/**
 * Makes every slug unique.
 *
 * Two accounts called "Privat" would otherwise share a topic and overwrite
 * each other, so the later ones get a counter.
 */
export function accountSlugs(accounts: AccountOverview[]): Map<string, string> {
  const used = new Set<string>();
  const result = new Map<string, string>();

  for (const overview of accounts) {
    const base = accountSlug(overview);
    let slug = base;
    let counter = 2;
    while (used.has(slug)) slug = `${base}_${counter++}`;
    used.add(slug);
    result.set(overview.account.id, slug);
  }
  return result;
}

export interface Topics {
  /** Online / offline, also used as the will message. */
  status: string;
  state: string;
  accountState: (slug: string) => string;
  accountCommand: (slug: string) => string;
  /** Wildcard the bridge subscribes to. */
  accountCommandFilter: string;
}

export function buildTopics(baseTopic: string): Topics {
  const base = baseTopic.replace(/^\/+|\/+$/g, '') || 'amberchest';
  return {
    status: `${base}/status`,
    state: `${base}/state`,
    accountState: (slug) => `${base}/account/${slug}/state`,
    accountCommand: (slug) => `${base}/account/${slug}/set`,
    accountCommandFilter: `${base}/account/+/set`,
  };
}

/** The account slug sits between `account/` and `/set`. */
export function slugFromCommandTopic(topic: string): string | null {
  const match = /account\/([^/]+)\/set$/.exec(topic);
  return match?.[1] ?? null;
}

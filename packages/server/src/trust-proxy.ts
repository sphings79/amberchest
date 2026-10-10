/**
 * Which proxies may tell the server who the client is.
 *
 * `X-Forwarded-For` is only worth believing when it comes from a proxy of
 * your own. Trusted from anyone, it is just a header an attacker writes, and
 * every limit that goes by client address can be talked around with it.
 *
 * The default trusts loopback and private networks, which is where a reverse
 * proxy in front of a container lives (Traefik, nginx, Caddy on the same
 * host or the same Docker network). A client that reaches the port directly
 * from the internet is judged by its own address.
 *
 * `AMBERCHEST_TRUSTED_PROXIES` overrides that: `none`, a number of proxy
 * hops, or a comma separated list of addresses and CIDR ranges.
 */
export type TrustProxy = boolean | string[] | ((address: string, hop: number) => boolean);

export const DEFAULT_TRUSTED_PROXIES = ['loopback', 'linklocal', 'uniquelocal'];

export function trustProxyFromEnvironment(value: string | undefined): TrustProxy {
  const text = value?.trim();
  if (!text) return DEFAULT_TRUSTED_PROXIES;
  if (text.toLowerCase() === 'none') return false;
  if (/^\d+$/.test(text)) {
    // The nearest N hops are ours; whatever is further out is the client's say-so.
    const hops = Number(text);
    return (_address, hop) => hop < hops;
  }
  return text
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

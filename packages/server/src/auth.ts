import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';

export type AuthMode = 'none' | 'token' | 'password';

/**
 * What a login may do. An admin can do everything; a viewer can browse,
 * search, read and download, and nothing that changes the archive, the
 * settings or the accounts.
 */
export type Role = 'admin' | 'viewer';

/**
 * Compares two secrets without revealing how much of them matches, or how
 * long they are: both are hashed to the same length first.
 */
function sameSecret(given: string, expected: string): boolean {
  const digest = (value: string): Buffer => createHash('sha256').update(value, 'utf8').digest();
  return timingSafeEqual(digest(given), digest(expected));
}

/**
 * Access control for the HTTP API.
 *
 * The desktop app runs on 127.0.0.1 and hands the frontend a random token that
 * only exists for the lifetime of the process. The container asks for the
 * password from `AMBERCHEST_UI_PASSWORD` and issues session tokens. A second
 * password, `AMBERCHEST_UI_PASSWORD_READONLY`, logs in as a viewer.
 */
export class AuthGuard {
  private readonly sessions = new Map<string, Role>();
  private readonly viewerSecret: string | null;

  constructor(
    readonly mode: AuthMode,
    private readonly secret: string | null,
    viewerSecret: string | null = null,
  ) {
    // A viewer password only means something next to an admin password, and
    // it has to differ from it - otherwise it could never be told apart.
    this.viewerSecret =
      mode === 'password' && secret && viewerSecret && viewerSecret !== secret ? viewerSecret : null;
    if (mode === 'token' && secret) this.sessions.set(secret, 'admin');
  }

  static fromEnvironment(env: NodeJS.ProcessEnv = process.env): AuthGuard {
    const password = env.AMBERCHEST_UI_PASSWORD;
    if (password) {
      return new AuthGuard('password', password, env.AMBERCHEST_UI_PASSWORD_READONLY || null);
    }
    return new AuthGuard('none', null);
  }

  static withToken(token = randomBytes(24).toString('base64url')): AuthGuard {
    return new AuthGuard('token', token);
  }

  get token(): string | null {
    return this.mode === 'token' ? this.secret : null;
  }

  /** Whether the second, read-only password is in effect. */
  get hasViewer(): boolean {
    return this.viewerSecret !== null;
  }

  /** Exchanges a UI password for a session token and the role it grants. */
  login(password: string): { token: string; role: Role } | null {
    if (this.mode !== 'password' || !this.secret) return null;

    // Both are always compared, so a miss takes as long as a hit.
    const isAdmin = sameSecret(password, this.secret);
    const isViewer = this.viewerSecret ? sameSecret(password, this.viewerSecret) : false;
    const role: Role | null = isAdmin ? 'admin' : isViewer ? 'viewer' : null;
    if (!role) return null;

    const token = randomBytes(24).toString('base64url');
    this.sessions.set(token, role);
    return { token, role };
  }

  logout(token: string): void {
    // The desktop token is the only way back in; it is not a login session.
    if (this.mode !== 'password') return;
    this.sessions.delete(token);
  }

  /** The role behind a token, or null when there is no valid session. */
  roleOf(token: string | null | undefined): Role | null {
    if (this.mode === 'none') return 'admin';
    if (!token) return null;
    return this.sessions.get(token) ?? null;
  }

  isValid(token: string | null | undefined): boolean {
    return this.roleOf(token) !== null;
  }

  /** Reads the token from the Authorization header or the query string. */
  tokenFromRequest(request: FastifyRequest): string | null {
    const header = request.headers.authorization;
    if (header?.startsWith('Bearer ')) return header.slice(7);
    const query = request.query as Record<string, string> | undefined;
    return query?.token ?? null;
  }
}

/**
 * The calls a viewer may make.
 *
 * An allowlist on purpose: a route that is added later is closed to viewers
 * until someone decides otherwise here, instead of open until someone
 * remembers to close it.
 */
const VIEWER_ROUTES: ReadonlyArray<{ method: string; path: RegExp }> = [
  // What there is to read.
  { method: 'GET', path: /^\/api\/accounts$/ },
  { method: 'GET', path: /^\/api\/accounts\/[^/]+\/local-folders$/ },
  { method: 'GET', path: /^\/api\/search$/ },
  // One message, its source, its PDF and its attachments.
  { method: 'GET', path: /^\/api\/accounts\/[^/]+\/messages\/[^/]+$/ },
  { method: 'GET', path: /^\/api\/accounts\/[^/]+\/messages\/[^/]+\/raw$/ },
  { method: 'GET', path: /^\/api\/accounts\/[^/]+\/messages\/[^/]+\/pdf$/ },
  { method: 'GET', path: /^\/api\/accounts\/[^/]+\/messages\/[^/]+\/attachments\/[^/]+$/ },
  // Export files (.eml, mbox, PDF, zip) built from a search or a folder.
  { method: 'GET', path: /^\/api\/exports$/ },
  { method: 'POST', path: /^\/api\/exports$/ },
  { method: 'POST', path: /^\/api\/exports\/[^/]+\/cancel$/ },
  { method: 'GET', path: /^\/api\/exports\/[^/]+\/download$/ },
  // Cron expression and next run, which the integration shows as a sensor.
  { method: 'GET', path: /^\/api\/schedule$/ },
  // Progress of the export files above; the socket sends a viewer nothing else.
  { method: 'GET', path: /^\/api\/events$/ },
  // Leaving; the configuration stays unlocked for everyone else.
  { method: 'POST', path: /^\/api\/logout$/ },
];

/** Whether a viewer may call this method and path (query string excluded). */
export function viewerMayCall(method: string, path: string): boolean {
  // Fastify serves HEAD from the GET handler, so it needs the same answer.
  const upper = method.toUpperCase();
  const verb = upper === 'HEAD' ? 'GET' : upper;
  return VIEWER_ROUTES.some((route) => route.method === verb && route.path.test(path));
}

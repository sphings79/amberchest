import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';

export type AuthMode = 'none' | 'token' | 'password';

/**
 * Access control for the HTTP API.
 *
 * The desktop app runs on 127.0.0.1 and hands the frontend a random token that
 * only exists for the lifetime of the process. The container asks for the
 * password from `MAIL_ARCHIVER_UI_PASSWORD` and issues session tokens.
 */
export class AuthGuard {
  private readonly sessions = new Set<string>();

  constructor(
    readonly mode: AuthMode,
    private readonly secret: string | null,
  ) {
    if (mode === 'token' && secret) this.sessions.add(secret);
  }

  static fromEnvironment(env: NodeJS.ProcessEnv = process.env): AuthGuard {
    const password = env.MAIL_ARCHIVER_UI_PASSWORD;
    if (password) return new AuthGuard('password', password);
    return new AuthGuard('none', null);
  }

  static withToken(token = randomBytes(24).toString('base64url')): AuthGuard {
    return new AuthGuard('token', token);
  }

  get token(): string | null {
    return this.mode === 'token' ? this.secret : null;
  }

  /** Exchanges the UI password for a session token. */
  login(password: string): string | null {
    if (this.mode !== 'password' || !this.secret) return null;
    const given = Buffer.from(password, 'utf8');
    const expected = Buffer.from(this.secret, 'utf8');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    const token = randomBytes(24).toString('base64url');
    this.sessions.add(token);
    return token;
  }

  logout(token: string): void {
    this.sessions.delete(token);
  }

  isValid(token: string | null | undefined): boolean {
    if (this.mode === 'none') return true;
    if (!token) return false;
    return this.sessions.has(token);
  }

  /** Reads the token from the Authorization header or the query string. */
  tokenFromRequest(request: FastifyRequest): string | null {
    const header = request.headers.authorization;
    if (header?.startsWith('Bearer ')) return header.slice(7);
    const query = request.query as Record<string, string> | undefined;
    return query?.token ?? null;
  }
}

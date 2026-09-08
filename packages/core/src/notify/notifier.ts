import type { NotificationSettings } from '../types.js';
import { logger } from '../util/logger.js';

export type NotificationEvent =
  | 'backupFailed'
  | 'backupFinished'
  | 'verifyProblems'
  | 'lowDiskSpace'
  | 'test';

export interface Notification {
  event: NotificationEvent;
  title: string;
  message: string;
  level: 'info' | 'warning' | 'error';
  /** Anything worth passing on to a receiver that reads JSON. */
  details?: Record<string, unknown>;
}

/**
 * Sends a message to whatever the user pointed at.
 *
 * A backup that fails at three in the morning is only useful to know about if
 * somebody hears it. One webhook covers ntfy, Gotify, Discord, Apprise and
 * every other service that takes a POST, so this has a format rather than five
 * separate integrations.
 */
export class Notifier {
  constructor(private readonly settings: () => NotificationSettings) {}

  /** Whether this kind of event is wanted at all. */
  wants(event: NotificationEvent): boolean {
    const settings = this.settings();
    if (!settings.enabled || !settings.url) return false;
    if (event === 'test') return true;
    return settings.events[event];
  }

  async send(notification: Notification): Promise<void> {
    if (!this.wants(notification.event)) return;
    const settings = this.settings();

    const { body, headers, contentType } = this.render(notification, settings);
    try {
      const response = await fetch(settings.url, {
        method: 'POST',
        headers: {
          'content-type': contentType,
          ...headers,
          ...parseAuthHeader(settings.authHeader),
        },
        body,
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        logger.warn(`Notification rejected with HTTP ${response.status}`);
        return;
      }
      logger.debug(`Notification sent: ${notification.title}`);
    } catch (error) {
      // A notification that fails must never take the backup down with it.
      logger.warn(`Notification could not be sent: ${(error as Error).message}`);
    }
  }

  /** Same as send, but the caller learns whether it worked - for the test button. */
  async trySend(notification: Notification): Promise<{ ok: boolean; error?: string }> {
    const settings = this.settings();
    if (!settings.url) return { ok: false, error: 'No address configured' };

    const { body, headers, contentType } = this.render(notification, settings);
    try {
      const response = await fetch(settings.url, {
        method: 'POST',
        headers: {
          'content-type': contentType,
          ...headers,
          ...parseAuthHeader(settings.authHeader),
        },
        body,
        signal: AbortSignal.timeout(15_000),
      });
      return response.ok ? { ok: true } : { ok: false, error: `HTTP ${response.status}` };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  }

  private render(
    notification: Notification,
    settings: NotificationSettings,
  ): { body: string; headers: Record<string, string>; contentType: string } {
    const text = `${notification.title}\n\n${notification.message}`;

    switch (settings.format) {
      case 'ntfy':
        // ntfy takes the message as the plain body and the rest as headers.
        return {
          body: notification.message,
          contentType: 'text/plain; charset=utf-8',
          headers: {
            title: notification.title,
            priority: notification.level === 'error' ? '4' : '3',
            tags: notification.level === 'error' ? 'rotating_light' : 'envelope',
          },
        };
      case 'gotify':
        return {
          body: JSON.stringify({
            title: notification.title,
            message: notification.message,
            priority: notification.level === 'error' ? 8 : 4,
          }),
          contentType: 'application/json',
          headers: {},
        };
      case 'discord':
        return {
          body: JSON.stringify({ content: `**${notification.title}**\n${notification.message}` }),
          contentType: 'application/json',
          headers: {},
        };
      case 'apprise':
        return {
          body: JSON.stringify({
            title: notification.title,
            body: notification.message,
            type: notification.level === 'error' ? 'failure' : 'info',
          }),
          contentType: 'application/json',
          headers: {},
        };
      case 'json':
      default:
        return {
          body: JSON.stringify({
            event: notification.event,
            level: notification.level,
            title: notification.title,
            message: notification.message,
            text,
            at: new Date().toISOString(),
            ...(notification.details ? { details: notification.details } : {}),
          }),
          contentType: 'application/json',
          headers: {},
        };
    }
  }
}

/** Turns "X-Token: abc" into a header object; empty input yields nothing. */
function parseAuthHeader(value: string): Record<string, string> {
  const trimmed = value.trim();
  if (!trimmed) return {};
  const index = trimmed.indexOf(':');
  if (index < 1) return {};
  return { [trimmed.slice(0, index).trim()]: trimmed.slice(index + 1).trim() };
}

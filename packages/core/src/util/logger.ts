import { EventEmitter } from 'node:events';
import type { LogEntry, LogLevel } from '../types.js';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * Process wide log bus. The server subscribes to it and forwards entries to
 * connected clients; a ring buffer keeps the most recent entries so a client
 * that connects mid-run still sees context.
 */
export class Logger extends EventEmitter {
  private buffer: LogEntry[] = [];
  private minLevel: LogLevel = 'info';

  constructor(private readonly bufferSize = 2000) {
    super();
    this.setMaxListeners(50);
  }

  setLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  log(level: LogLevel, message: string, options: { accountId?: string | null; detail?: string } = {}): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) return;
    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      accountId: options.accountId ?? null,
      message,
      ...(options.detail ? { detail: options.detail } : {}),
    };
    this.buffer.push(entry);
    if (this.buffer.length > this.bufferSize) this.buffer.splice(0, this.buffer.length - this.bufferSize);
    this.emit('entry', entry);
  }

  debug(message: string, options?: { accountId?: string | null; detail?: string }): void {
    this.log('debug', message, options);
  }

  info(message: string, options?: { accountId?: string | null; detail?: string }): void {
    this.log('info', message, options);
  }

  warn(message: string, options?: { accountId?: string | null; detail?: string }): void {
    this.log('warn', message, options);
  }

  error(message: string, options?: { accountId?: string | null; detail?: string }): void {
    this.log('error', message, options);
  }

  recent(limit = 500): LogEntry[] {
    return this.buffer.slice(-limit);
  }
}

export const logger = new Logger();

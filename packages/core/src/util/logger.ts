import { EventEmitter } from 'node:events';
import type { LogEntry, LogLevel } from '../types.js';
import { RotatingLogFile } from './log-file.js';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * Process wide log bus. The server subscribes to it and forwards entries to
 * connected clients; a ring buffer keeps the most recent entries so a client
 * that connects mid-run still sees context.
 */
export class Logger extends EventEmitter {
  private buffer: LogEntry[] = [];
  private minLevel: LogLevel = 'info';
  private file: RotatingLogFile | null = null;

  constructor(private readonly bufferSize = 2000) {
    super();
    this.setMaxListeners(50);
  }

  setLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  getLevel(): LogLevel {
    return this.minLevel;
  }

  /** Also append every entry to this file; null stops that. True when this changed anything. */
  setFile(path: string | null): boolean {
    if (path === null) {
      const had = this.file !== null;
      this.file = null;
      return had;
    }
    if (this.file?.path === path) return false;
    this.file = new RotatingLogFile(path, undefined, undefined, (error) =>
      this.log('error', `The log file ${path} cannot be written: ${error.message}`),
    );
    return true;
  }

  /** The log files that exist, newest first; empty when none is being written. */
  logFiles(): string[] {
    return this.file?.files() ?? [];
  }

  /** One line of text, the form both the container's output and the file use. */
  static format(entry: LogEntry): string {
    return `${entry.ts} [${entry.level}] ${entry.message}${entry.detail ? `\n${entry.detail}` : ''}`;
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
    this.file?.write(Logger.format(entry));
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

import { EventEmitter } from 'node:events';
import type { ArchiveDatabase } from '../db/database.js';
import type { ImapConnectionOptions } from '../imap/client.js';
import type { Account } from '../types.js';
import { AdoptEngine, type AdoptOptions, type AdoptProgress } from './engine.js';

export interface AdoptManagerOptions {
  db: ArchiveDatabase;
  archiveBaseDir: () => string;
  encryptionKey?: () => Buffer | null;
  connectionFor?: (account: Account) => Promise<ImapConnectionOptions>;
}

/** One adoption at a time; two would fight over the same index rows. */
export class AdoptManager extends EventEmitter {
  private running: string | null = null;
  private lastProgress: AdoptProgress | null = null;

  constructor(private readonly options: AdoptManagerOptions) {
    super();
    this.setMaxListeners(100);
  }

  get isRunning(): boolean {
    return this.running !== null;
  }

  get progress(): AdoptProgress | null {
    return this.lastProgress;
  }

  async start(
    account: Account,
    options: { askServer?: boolean; includeDeleted?: boolean } = {},
  ): Promise<AdoptProgress> {
    if (this.running) throw new Error('An adoption is already running');

    const engineOptions: AdoptOptions = {
      db: this.options.db,
      archiveBaseDir: this.options.archiveBaseDir(),
      encryptionKey: this.options.encryptionKey?.() ?? null,
      includeDeleted: options.includeDeleted ?? false,
      ...(options.askServer && this.options.connectionFor
        ? { connection: await this.options.connectionFor(account) }
        : {}),
    };

    const engine = new AdoptEngine(account, engineOptions);
    engine.on('progress', (progress: AdoptProgress) => {
      this.lastProgress = progress;
      this.emit('progress', progress);
    });

    this.running = account.id;
    try {
      return await engine.run();
    } finally {
      this.running = null;
    }
  }
}

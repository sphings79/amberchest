import { EventEmitter } from 'node:events';
import type { Account } from '../types.js';
import {
  TransferEngine,
  type TransferOptions,
  type TransferProgress,
  type TransferTarget,
} from './engine.js';

export interface TransferManagerOptions {
  archiveBaseDir: () => string;
}

/** One transfer at a time; two would send the same files twice. */
export class TransferManager extends EventEmitter {
  private current: TransferEngine | null = null;
  private lastProgress: TransferProgress | null = null;

  constructor(private readonly options: TransferManagerOptions) {
    super();
    this.setMaxListeners(100);
  }

  get isRunning(): boolean {
    return this.current !== null;
  }

  get progress(): TransferProgress | null {
    return this.lastProgress;
  }

  async start(
    account: Account,
    target: TransferTarget,
    options: { includeDeleted?: boolean } = {},
  ): Promise<TransferProgress> {
    if (this.current) throw new Error('A transfer is already running');

    const engineOptions: TransferOptions = {
      archiveBaseDir: this.options.archiveBaseDir(),
      target,
      includeDeleted: options.includeDeleted ?? false,
    };

    const engine = new TransferEngine(account, engineOptions);
    engine.on('progress', (progress: TransferProgress) => {
      this.lastProgress = progress;
      this.emit('progress', progress);
    });

    this.current = engine;
    try {
      return await engine.run();
    } finally {
      this.current = null;
    }
  }

  cancel(): boolean {
    if (!this.current) return false;
    this.current.cancel();
    return true;
  }
}

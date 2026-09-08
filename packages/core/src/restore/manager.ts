import { EventEmitter } from 'node:events';
import { RestoreEngine, type RestoreOptions, type RestoreProgress } from './engine.js';

/**
 * Runs one restore at a time.
 *
 * Deliberately global rather than per account: a restore writes to a mail
 * server, and two of them at once is never what someone meant.
 */
export class RestoreManager extends EventEmitter {
  private current: RestoreEngine | null = null;
  private lastProgress: RestoreProgress | null = null;

  get isRunning(): boolean {
    return this.current !== null;
  }

  get progress(): RestoreProgress | null {
    return this.lastProgress;
  }

  async start(options: RestoreOptions): Promise<RestoreProgress | null> {
    if (this.current) throw new Error('A restore is already running');

    const engine = new RestoreEngine(options);
    engine.on('progress', (progress: RestoreProgress) => {
      this.lastProgress = progress;
      this.emit('progress', progress);
    });

    this.current = engine;
    try {
      await engine.run();
    } catch {
      // Reported through the progress event.
    } finally {
      this.current = null;
    }
    return this.lastProgress;
  }

  cancel(): boolean {
    if (!this.current) return false;
    this.current.cancel();
    return true;
  }
}

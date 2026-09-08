import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { configDir } from '../config/locations.js';
import type { ArchiveDatabase } from '../db/database.js';
import type { SearchOptions } from '../search/search.js';
import type { Account } from '../types.js';
import { BundleEngine, purgeOldBundles, type BundleFormat, type BundleProgress } from './bundle.js';
import type { PdfRenderer } from './pdf.js';

export interface BundleManagerOptions {
  db: ArchiveDatabase;
  archiveBaseDir: () => string;
  resolveAccount: (accountId: string) => Account;
  pdfRenderer?: PdfRenderer | undefined;
  outputDir?: string;
}

export interface FinishedBundle {
  bundleId: string;
  fileName: string;
  path: string;
  size: number;
  createdAt: string;
}

/**
 * Keeps track of running and finished export bundles.
 *
 * Finished files stay on disk until they are picked up or age out, so a large
 * export does not have to be redone when a download is interrupted.
 */
export class BundleManager extends EventEmitter {
  private readonly running = new Map<string, BundleEngine>();
  private readonly finished = new Map<string, FinishedBundle>();
  readonly outputDir: string;

  constructor(private readonly options: BundleManagerOptions) {
    super();
    this.setMaxListeners(100);
    this.outputDir = options.outputDir ?? join(configDir(), 'exports');
    void purgeOldBundles(this.outputDir);
  }

  list(): FinishedBundle[] {
    return [...this.finished.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(bundleId: string): FinishedBundle | undefined {
    return this.finished.get(bundleId);
  }

  isRunning(): boolean {
    return this.running.size > 0;
  }

  /** Starts a bundle and resolves with its id right away. */
  start(format: BundleFormat, selection: SearchOptions): string {
    const engine = new BundleEngine(format, selection, {
      db: this.options.db,
      archiveBaseDir: this.options.archiveBaseDir(),
      outputDir: this.outputDir,
      resolveAccount: this.options.resolveAccount,
      pdfRenderer: this.options.pdfRenderer,
    });

    engine.on('progress', (progress: BundleProgress) => this.emit('progress', progress));
    this.running.set(engine.bundleId, engine);

    void engine
      .run()
      .then((result) => {
        this.finished.set(engine.bundleId, {
          bundleId: engine.bundleId,
          fileName: result.fileName,
          path: result.path,
          size: result.size,
          createdAt: new Date().toISOString(),
        });
      })
      .catch(() => {
        // Failure is reported through the progress event.
      })
      .finally(() => {
        this.running.delete(engine.bundleId);
      });

    return engine.bundleId;
  }

  cancel(bundleId: string): boolean {
    const engine = this.running.get(bundleId);
    if (!engine) return false;
    engine.cancel();
    return true;
  }
}

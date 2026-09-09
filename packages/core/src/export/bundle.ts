import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ArchiveDatabase } from '../db/database.js';
import { loadMessage, loadMessageSource } from '../search/message.js';
import { searchMessages, type SearchOptions } from '../search/search.js';
import type { Account } from '../types.js';
import { logger } from '../util/logger.js';
import { sanitizeSegment } from '../util/paths.js';
import { MboxWriter } from './mbox.js';
import { messageToPrintableHtml, type PdfRenderer } from './pdf.js';
import { ZipWriter } from './zip.js';

export type BundleFormat =
  /** One .eml per message inside a ZIP, folder structure preserved. */
  | 'eml-zip'
  /** A single mbox file, ready to import into Thunderbird or Apple Mail. */
  | 'mbox'
  /** One PDF per message inside a ZIP. */
  | 'pdf-zip';

export interface BundleStats {
  messagesTotal: number;
  messagesDone: number;
  messagesFailed: number;
  bytesWritten: number;
}

export type BundlePhase = 'collecting' | 'writing' | 'done' | 'cancelled' | 'failed';

export interface BundleProgress {
  bundleId: string;
  accountId: string | null;
  format: BundleFormat;
  phase: BundlePhase;
  stats: BundleStats;
  startedAt: string;
  /** Set once the file exists. */
  fileName?: string;
  error?: string;
}

export class BundleCancelledError extends Error {
  constructor() {
    super('Export cancelled');
    this.name = 'BundleCancelledError';
  }
}

/** Hard ceiling so one click cannot start a week long job by accident. */
export const MAX_BUNDLE_MESSAGES = 20_000;

export interface BundleEngineOptions {
  db: ArchiveDatabase;
  archiveBaseDir: string;
  /** Directory the finished files are written to. */
  outputDir: string;
  /** Needed when the archive is encrypted. */
  encryptionKey?: Buffer | null;
  /** Resolves an account by id; a bundle may span several of them. */
  resolveAccount: (accountId: string) => Account;
  /** Only needed for the PDF format. */
  pdfRenderer?: PdfRenderer | undefined;
}

const EXTENSIONS: Record<BundleFormat, string> = {
  'eml-zip': 'zip',
  mbox: 'mbox',
  'pdf-zip': 'zip',
};

/**
 * Packs a selection of archived messages into one downloadable file.
 *
 * The selection is expressed with the same filters as the search screen, so
 * "everything I am currently looking at" is exactly what gets exported.
 */
export class BundleEngine extends EventEmitter {
  readonly bundleId = randomUUID();

  private cancelled = false;
  private readonly stats: BundleStats = {
    messagesTotal: 0,
    messagesDone: 0,
    messagesFailed: 0,
    bytesWritten: 0,
  };
  private readonly startedAt = new Date().toISOString();

  constructor(
    private readonly format: BundleFormat,
    private readonly selection: SearchOptions,
    private readonly options: BundleEngineOptions,
  ) {
    super();
  }

  cancel(): void {
    this.cancelled = true;
  }

  private checkCancelled(): void {
    if (this.cancelled) throw new BundleCancelledError();
  }

  private emitProgress(phase: BundlePhase, extra: Partial<BundleProgress> = {}): void {
    this.emit('progress', {
      bundleId: this.bundleId,
      accountId: this.selection.accountId ?? null,
      format: this.format,
      phase,
      stats: { ...this.stats },
      startedAt: this.startedAt,
      ...extra,
    } satisfies BundleProgress);
  }

  async run(): Promise<{ fileName: string; path: string; size: number }> {
    this.emitProgress('collecting');

    try {
      const hits = searchMessages(this.options.db, {
        ...this.selection,
        limit: MAX_BUNDLE_MESSAGES,
        offset: 0,
      }).hits;

      this.stats.messagesTotal = hits.length;
      this.emitProgress('writing');

      const fileName = this.buildFileName();
      const path = join(this.options.outputDir, fileName);
      await mkdir(this.options.outputDir, { recursive: true });

      if (this.format === 'mbox') await this.writeMbox(hits, path);
      else if (this.format === 'eml-zip') await this.writeEmlZip(hits, path);
      else await this.writePdfZip(hits, path);

      const info = await stat(path);
      this.stats.bytesWritten = info.size;
      this.emitProgress('done', { fileName });

      logger.info(`Exported ${this.stats.messagesDone} message(s) as ${fileName}`);
      return { fileName, path, size: info.size };
    } catch (error) {
      if (error instanceof BundleCancelledError) {
        this.emitProgress('cancelled');
        throw error;
      }
      const message = (error as Error).message;
      this.emitProgress('failed', { error: message });
      throw error;
    }
  }

  private buildFileName(): string {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const account = this.selection.accountId
      ? sanitizeSegment(this.options.resolveAccount(this.selection.accountId).email)
      : 'alle-konten';
    return `amberchest_${account}_${stamp}.${EXTENSIONS[this.format]}`;
  }

  private async sourceOf(hit: { accountId: string; messageId: number }): Promise<Buffer | null> {
    try {
      const account = this.options.resolveAccount(hit.accountId);
      const loaded = await loadMessageSource(account, hit.messageId, {
        db: this.options.db,
        archiveBaseDir: this.options.archiveBaseDir,
        encryptionKey: this.options.encryptionKey ?? null,
      });
      return loaded.source;
    } catch {
      this.stats.messagesFailed += 1;
      return null;
    }
  }

  private async writeMbox(
    hits: Array<{ accountId: string; messageId: number; fromAddr: string | null; internalDate: string }>,
    path: string,
  ): Promise<void> {
    const writer = new MboxWriter();
    for (const hit of hits) {
      this.checkCancelled();
      const source = await this.sourceOf(hit);
      if (source) writer.add(source, hit.fromAddr, new Date(hit.internalDate));
      this.stats.messagesDone += 1;
      if (this.stats.messagesDone % 25 === 0) this.emitProgress('writing');
    }
    await writeFile(path, writer.finish());
  }

  private async writeEmlZip(
    hits: Array<{ accountId: string; messageId: number; folderPath: string; internalDate: string }>,
    path: string,
  ): Promise<void> {
    const zip = new ZipWriter();
    const taken = new Set<string>();

    for (const hit of hits) {
      this.checkCancelled();
      const account = this.options.resolveAccount(hit.accountId);
      const loaded = await this.loadFileFor(hit);
      if (loaded) {
        const folder = hit.folderPath.split(/[./]/).map(sanitizeSegment).join('/');
        let name = `${sanitizeSegment(account.email)}/${folder}/${loaded.fileName}`;
        // The archive may hold the same file name in two accounts.
        let counter = 1;
        while (taken.has(name)) {
          name = name.replace(/(\.eml)$/, `_${counter}$1`);
          counter += 1;
        }
        taken.add(name);
        zip.add(name, loaded.source, new Date(hit.internalDate));
      }
      this.stats.messagesDone += 1;
      if (this.stats.messagesDone % 25 === 0) this.emitProgress('writing');
    }

    await zip.writeTo(path);
  }

  private async loadFileFor(hit: {
    accountId: string;
    messageId: number;
  }): Promise<{ source: Buffer; fileName: string } | null> {
    try {
      const account = this.options.resolveAccount(hit.accountId);
      const loaded = await loadMessageSource(account, hit.messageId, {
        db: this.options.db,
        archiveBaseDir: this.options.archiveBaseDir,
        encryptionKey: this.options.encryptionKey ?? null,
      });
      return { source: loaded.source, fileName: loaded.fileName };
    } catch {
      this.stats.messagesFailed += 1;
      return null;
    }
  }

  private async writePdfZip(
    hits: Array<{ accountId: string; messageId: number; folderPath: string; internalDate: string }>,
    path: string,
  ): Promise<void> {
    const renderer = this.options.pdfRenderer;
    if (!renderer) throw new Error('PDF export is not available on this installation');

    const zip = new ZipWriter();
    const taken = new Set<string>();

    for (const hit of hits) {
      this.checkCancelled();
      try {
        const account = this.options.resolveAccount(hit.accountId);
        const message = await loadMessage(account, hit.messageId, {
          db: this.options.db,
          archiveBaseDir: this.options.archiveBaseDir,
          encryptionKey: this.options.encryptionKey ?? null,
        });
        const pdf = await renderer(messageToPrintableHtml(message));

        const stamp = new Date(hit.internalDate).toISOString().slice(0, 10);
        const subject = sanitizeSegment(message.subject ?? 'ohne-betreff').slice(0, 60);
        const folder = hit.folderPath.split(/[./]/).map(sanitizeSegment).join('/');
        let name = `${sanitizeSegment(account.email)}/${folder}/${stamp}_${subject}.pdf`;
        let counter = 1;
        while (taken.has(name)) {
          name = name.replace(/(\.pdf)$/, `_${counter}$1`);
          counter += 1;
        }
        taken.add(name);
        zip.add(name, pdf, new Date(hit.internalDate));
      } catch (error) {
        this.stats.messagesFailed += 1;
        logger.debug(`PDF export failed for message ${hit.messageId}: ${(error as Error).message}`);
      }
      this.stats.messagesDone += 1;
      this.emitProgress('writing');
    }

    await zip.writeTo(path);
  }
}

/** Removes finished bundles that nobody picked up. */
export async function purgeOldBundles(outputDir: string, maxAgeHours = 24 * 7): Promise<void> {
  try {
    const entries = await readdir(outputDir, { withFileTypes: true });
    const cutoff = Date.now() - maxAgeHours * 60 * 60 * 1000;
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const path = join(outputDir, entry.name);
      const info = await stat(path);
      if (info.mtimeMs < cutoff) await rm(path, { force: true });
    }
  } catch {
    // Directory does not exist yet - nothing to purge.
  }
}

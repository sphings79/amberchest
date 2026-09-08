import type { BundleFormat } from '@mail-archiver/core';
import { Download, FileArchive, FileText, Files } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { api, downloadUrl } from '../api/client.js';
import { Button, Modal, ProgressBar, cx } from '../components/ui.js';
import { useApp } from '../state.js';
import { formatBytes } from './Overview.js';

/** Mirrors MAX_BUNDLE_MESSAGES in the core package. */
const MAX_MESSAGES = 20_000;

export interface ExportSelection {
  q: string;
  account?: string | undefined;
  folders: string[];
  from?: string | undefined;
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
  withAttachments: boolean;
  /** Number of messages the current filters match, for the hint. */
  total: number;
}

export function ExportDialog({
  selection,
  onClose,
}: {
  selection: ExportSelection;
  onClose: () => void;
}): ReactNode {
  const { t } = useTranslation();
  const { bundleProgress } = useApp();

  const [format, setFormat] = useState<BundleFormat>('eml-zip');
  const [pdfAvailable, setPdfAvailable] = useState(true);
  const [bundleId, setBundleId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .exports()
      .then((value) => setPdfAvailable(value.pdfAvailable))
      .catch(() => setPdfAvailable(false));
  }, []);

  const progress = bundleId ? bundleProgress[bundleId] : undefined;
  const running = progress ? !['done', 'failed', 'cancelled'].includes(progress.phase) : false;
  const tooMany = selection.total > MAX_MESSAGES;

  const start = async (): Promise<void> => {
    setError(null);
    try {
      const result = await api.startExportBundle({
        format,
        q: selection.q,
        account: selection.account,
        folders: selection.folders,
        from: selection.from,
        dateFrom: selection.dateFrom,
        dateTo: selection.dateTo,
        withAttachments: selection.withAttachments,
      });
      setBundleId(result.bundleId);
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  const formats: Array<{ id: BundleFormat; label: string; hint: string; icon: ReactNode }> = [
    { id: 'eml-zip', label: t('export.formatEmlZip'), hint: t('export.formatEmlZipHint'), icon: <Files size={16} /> },
    { id: 'mbox', label: t('export.formatMbox'), hint: t('export.formatMboxHint'), icon: <FileArchive size={16} /> },
    { id: 'pdf-zip', label: t('export.formatPdfZip'), hint: t('export.formatPdfZipHint'), icon: <FileText size={16} /> },
  ];

  return (
    <Modal
      open
      title={t('export.title')}
      onClose={onClose}
      footer={
        progress?.phase === 'done' ? (
          <a href={downloadUrl(`/exports/${bundleId}/download`)} download>
            <Button variant="primary">
              <Download size={15} />
              {t('export.download')}
            </Button>
          </a>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              {t('account.cancel')}
            </Button>
            <Button
              variant="primary"
              disabled={running || tooMany || (format === 'pdf-zip' && !pdfAvailable)}
              onClick={() => void start()}
            >
              {t('export.button')}
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {t('export.scope', { count: selection.total })}
        </p>

        {tooMany && (
          <div className="rounded-xl px-3 py-2 text-xs" style={{ background: 'var(--warn-soft)', color: 'var(--warn)' }}>
            {t('export.tooMany', { max: MAX_MESSAGES.toLocaleString() })}
          </div>
        )}

        <div className="flex flex-col gap-2">
          {formats.map((entry) => {
            const disabled = entry.id === 'pdf-zip' && !pdfAvailable;
            const active = format === entry.id;
            return (
              <button
                key={entry.id}
                type="button"
                disabled={disabled || running}
                onClick={() => setFormat(entry.id)}
                className={cx('flex items-start gap-2.5 rounded-xl border p-3 text-left transition disabled:opacity-45')}
                style={{
                  background: active ? 'var(--accent-soft)' : 'var(--surface-2)',
                  borderColor: active ? 'var(--accent)' : 'var(--border)',
                }}
              >
                <span style={{ color: active ? 'var(--accent)' : 'var(--text-muted)' }}>{entry.icon}</span>
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium" style={{ color: active ? 'var(--accent)' : 'var(--text)' }}>
                    {entry.label}
                  </span>
                  <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
                    {disabled ? t('export.pdfUnavailable') : entry.hint}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        {progress && (
          <div className="flex flex-col gap-2 rounded-xl p-3" style={{ background: 'var(--surface-2)' }}>
            <div className="flex items-center gap-2 text-xs">
              <span className="font-medium">
                {progress.phase === 'done'
                  ? t('export.ready', { name: progress.fileName ?? '' })
                  : progress.phase === 'failed'
                    ? t('export.failed')
                    : t('export.running')}
              </span>
              <span className="ml-auto tabular-nums" style={{ color: 'var(--text-faint)' }}>
                {t('export.progress', {
                  done: progress.stats.messagesDone,
                  total: progress.stats.messagesTotal,
                })}
              </span>
            </div>
            <ProgressBar
              value={
                progress.stats.messagesTotal > 0
                  ? progress.stats.messagesDone / progress.stats.messagesTotal
                  : 0
              }
              indeterminate={running && progress.stats.messagesTotal === 0}
            />
            {progress.phase === 'done' && (
              <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
                {formatBytes(progress.stats.bytesWritten)}
              </span>
            )}
            {progress.error && (
              <span className="text-xs" style={{ color: 'var(--danger)' }}>
                {progress.error}
              </span>
            )}
          </div>
        )}

        {error && (
          <div className="rounded-xl px-3 py-2 text-xs" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}

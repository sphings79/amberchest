import type { AccountOverview, DedupePlan } from '@amberchest/core';
import { CircleCheck, Layers, Square } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client.js';
import { Button, Modal, ProgressBar } from '../components/ui.js';
import { useApp } from '../state.js';
import { formatBytes } from './Overview.js';

/**
 * Stores messages once that the archive holds in several folders.
 *
 * Gmail shows a mail in its folder and in All Mail, so an archive made without
 * "Store a message only once" has both. The dialog shows what would be saved
 * first; a copy is only replaced when both files match their checksum.
 */
export function DedupeDialog({
  overview,
  onClose,
}: {
  overview: AccountOverview;
  onClose: () => void;
}): ReactNode {
  const { t, i18n } = useTranslation();
  const { dedupeProgress } = useApp();
  const account = overview.account;

  const [plan, setPlan] = useState<DedupePlan | null>(null);
  const [enableLinking, setEnableLinking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const progress = dedupeProgress[account.id] ?? null;
  const running = progress ? !['done', 'failed', 'cancelled'].includes(progress.phase) : false;

  // The plan reads the index only, so it can follow the progress of a run.
  useEffect(() => {
    let current = true;
    void api
      .planDedupe(account.id)
      .then((value) => current && setPlan(value))
      .catch((cause: Error) => current && setError(cause.message));
    return () => {
      current = false;
    };
  }, [account.id, progress?.stats.merged]);

  const n = (value: number): string => value.toLocaleString(i18n.language);

  const start = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api.startDedupe(account.id, { enableLinking });
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const stats = progress?.stats;
  return (
    <Modal
      open
      onClose={onClose}
      title={t('dedupe.title', { name: account.name })}
      footer={
        <div className="flex items-center gap-2">
          <Button onClick={onClose}>{t('common.close')}</Button>
          {running ? (
            <Button variant="danger" onClick={() => void api.cancelDedupe(account.id)}>
              <Square size={14} />
              {t('dedupe.stop')}
            </Button>
          ) : (
            <Button
              variant="primary"
              disabled={busy || !plan || plan.messages === 0}
              onClick={() => void start()}
            >
              <Layers size={15} />
              {t('dedupe.start', { count: n(plan?.messages ?? 0) })}
            </Button>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          {t('dedupe.intro')}
        </p>

        {plan && (
          <div className="rounded-xl p-3 text-xs" style={{ background: 'var(--surface-2)' }}>
            <div className="font-medium">
              {plan.messages === 0
                ? t('dedupe.nothing')
                : t('dedupe.plan', { count: n(plan.messages), size: formatBytes(plan.bytes) })}
            </div>
            {plan.folders.length > 0 && (
              <div className="mt-2 flex max-h-40 flex-col gap-1 overflow-y-auto">
                {plan.folders.map((folder) => (
                  <div key={folder.path} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate">{folder.path}</span>
                    <span className="tabular-nums" style={{ color: 'var(--text-faint)' }}>
                      {n(folder.messages)} · {formatBytes(folder.bytes)}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {plan.noChecksum > 0 && (
              <div className="mt-2" style={{ color: 'var(--warn)' }}>
                {t('dedupe.noChecksum', { count: n(plan.noChecksum) })}
              </div>
            )}
            {plan.differing > 0 && (
              <div className="mt-1" style={{ color: 'var(--text-muted)' }}>
                {t('dedupe.differing', { count: n(plan.differing) })}
              </div>
            )}
          </div>
        )}

        {!account.settings.linkDuplicates && !running && (
          <label className="flex items-start gap-2 text-xs leading-relaxed">
            <input
              type="checkbox"
              checked={enableLinking}
              onChange={(event) => setEnableLinking(event.target.checked)}
              className="mt-0.5 accent-[var(--accent)]"
            />
            <span>{t('dedupe.enableLinking')}</span>
          </label>
        )}

        {error && (
          <div className="rounded-xl px-3 py-2 text-xs" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>
            {error}
          </div>
        )}

        {progress && stats && (
          <div className="flex flex-col gap-2 rounded-xl p-3 text-xs" style={{ background: 'var(--surface-2)' }}>
            <div className="flex items-center gap-2">
              <span style={{ color: 'var(--text-muted)' }}>{t(`dedupe.phase.${progress.phase}`)}</span>
              {progress.currentFolder && (
                <span className="truncate" style={{ color: 'var(--text-faint)' }}>
                  {progress.currentFolder}
                </span>
              )}
              <span className="ml-auto tabular-nums" style={{ color: 'var(--text-faint)' }}>
                {n(stats.merged)} / {n(stats.candidates)}
              </span>
            </div>

            {running && (
              <ProgressBar
                value={stats.candidates > 0 ? stats.merged / stats.candidates : 0}
                indeterminate={stats.candidates === 0}
              />
            )}

            <div className="grid grid-cols-2 gap-1 tabular-nums" style={{ color: 'var(--text-muted)' }}>
              <span>{t('dedupe.merged', { count: n(stats.merged) })}</span>
              <span>{t('dedupe.freed', { size: formatBytes(stats.bytesFreed) })}</span>
              {stats.notVerified > 0 && <span>{t('dedupe.notVerified', { count: n(stats.notVerified) })}</span>}
              {stats.failed > 0 && <span>{t('dedupe.failed', { count: n(stats.failed) })}</span>}
            </div>

            {progress.phase === 'done' && (
              <div className="flex items-center gap-2" style={{ color: 'var(--ok)' }}>
                <CircleCheck size={15} />
                {t('dedupe.done')}
              </div>
            )}

            {progress.error && <div style={{ color: 'var(--danger)' }}>{progress.error}</div>}
          </div>
        )}
      </div>
    </Modal>
  );
}

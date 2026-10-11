import type { AccountOverview, RemovalPlan } from '@amberchest/core';
import { CircleCheck, CloudOff, Square, TriangleAlert } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client.js';
import { Button, Field, Input, Modal, ProgressBar } from '../components/ui.js';
import { useApp } from '../state.js';
import { formatBytes } from './Overview.js';

/**
 * Deletes archived mail on the server.
 *
 * The one screen that makes AmberChest change a mailbox, so it is built to be
 * slow: the number comes first, nothing starts before the account's name has
 * been typed, and the result says what was left alone and why.
 */
export function RemovalDialog({
  overview,
  onClose,
}: {
  overview: AccountOverview;
  onClose: () => void;
}): ReactNode {
  const { t, i18n } = useTranslation();
  const { removalProgress } = useApp();
  const account = overview.account;

  const [folders, setFolders] = useState<string[]>([]);
  const [olderThanDays, setOlderThanDays] = useState('');
  const [plan, setPlan] = useState<RemovalPlan | null>(null);
  const [confirmName, setConfirmName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const progress = removalProgress[account.id] ?? null;
  const running = progress ? !['done', 'failed', 'cancelled'].includes(progress.phase) : false;
  const days = olderThanDays.trim() === '' ? null : Math.max(0, Math.floor(Number(olderThanDays)) || 0);

  // The plan reads the index only, so it follows every change of the choice.
  useEffect(() => {
    let current = true;
    const timer = window.setTimeout(() => {
      void api
        .planRemoval(account.id, { folders, olderThanDays: days })
        .then((value) => current && setPlan(value))
        .catch((cause: Error) => current && setError(cause.message));
    }, 200);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [account.id, folders, days, progress?.stats.removed]);

  const n = (value: number): string => value.toLocaleString(i18n.language);
  const nameMatches = confirmName === account.name;

  const start = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api.startRemoval(account.id, { folders, olderThanDays: days, confirmName });
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
      title={t('removal.title', { name: account.name })}
      footer={
        <div className="flex items-center gap-2">
          <Button onClick={onClose}>{t('common.close')}</Button>
          {running ? (
            <Button variant="danger" onClick={() => void api.cancelRemoval(account.id)}>
              <Square size={14} />
              {t('removal.stop')}
            </Button>
          ) : (
            <Button
              variant="danger"
              disabled={busy || !nameMatches || !plan || plan.messages === 0}
              onClick={() => void start()}
            >
              <CloudOff size={15} />
              {t('removal.start', { count: n(plan?.messages ?? 0) })}
            </Button>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div
          className="flex items-start gap-2 rounded-xl px-3 py-2.5 text-xs leading-relaxed"
          style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}
        >
          <TriangleAlert size={15} className="mt-0.5 shrink-0" />
          <span>{t('removal.warning')}</span>
        </div>

        <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          {t('removal.intro')}
        </p>

        {plan && plan.folders.length > 0 && (
          <Field label={t('removal.folders')} hint={t('removal.foldersHint')}>
            <div className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded-xl p-2" style={{ background: 'var(--surface-2)' }}>
              {plan.folders.map((folder) => (
                <label key={folder.path} className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={folders.length === 0 || folders.includes(folder.path)}
                    disabled={running}
                    onChange={() =>
                      setFolders((current) =>
                        current.length === 0
                          ? plan.folders.map((entry) => entry.path).filter((path) => path !== folder.path)
                          : current.includes(folder.path)
                            ? current.filter((entry) => entry !== folder.path)
                            : [...current, folder.path],
                      )
                    }
                    className="accent-[var(--accent)]"
                  />
                  <span className="min-w-0 flex-1 truncate">{folder.path}</span>
                  <span className="tabular-nums" style={{ color: 'var(--text-faint)' }}>
                    {n(folder.messages)} · {formatBytes(folder.bytes)}
                  </span>
                </label>
              ))}
            </div>
          </Field>
        )}

        <Field label={t('removal.olderThan')} hint={t('removal.olderThanHint')}>
          <Input
            type="number"
            min={0}
            value={olderThanDays}
            placeholder="—"
            disabled={running}
            onChange={(event) => setOlderThanDays(event.target.value)}
          />
        </Field>

        {plan && (
          <div className="rounded-xl p-3 text-xs" style={{ background: 'var(--surface-2)' }}>
            <div className="font-medium">
              {t('removal.plan', { count: n(plan.messages), size: formatBytes(plan.bytes) })}
            </div>
            {plan.noChecksum > 0 && (
              <div className="mt-1" style={{ color: 'var(--warn)' }}>
                {t('removal.noChecksum', { count: n(plan.noChecksum) })}
              </div>
            )}
          </div>
        )}

        {!running && (
          <Field label={t('removal.confirm', { name: account.name })}>
            <Input
              value={confirmName}
              placeholder={account.name}
              autoComplete="off"
              onChange={(event) => setConfirmName(event.target.value)}
            />
          </Field>
        )}

        {error && (
          <div className="rounded-xl px-3 py-2 text-xs" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>
            {error}
          </div>
        )}

        {progress && stats && (
          <div className="flex flex-col gap-2 rounded-xl p-3 text-xs" style={{ background: 'var(--surface-2)' }}>
            <div className="flex items-center gap-2">
              <span style={{ color: 'var(--text-muted)' }}>{t(`removal.phase.${progress.phase}`)}</span>
              {progress.currentFolder && (
                <span className="truncate" style={{ color: 'var(--text-faint)' }}>
                  {progress.currentFolder}
                </span>
              )}
              <span className="ml-auto tabular-nums" style={{ color: 'var(--text-faint)' }}>
                {n(stats.removed)} / {n(stats.candidates)}
              </span>
            </div>

            {running && (
              <ProgressBar
                value={stats.candidates > 0 ? stats.removed / stats.candidates : 0}
                indeterminate={stats.candidates === 0}
              />
            )}

            <div className="grid grid-cols-2 gap-1 tabular-nums" style={{ color: 'var(--text-muted)' }}>
              <span>{t('removal.removed', { count: n(stats.removed) })}</span>
              <span>{formatBytes(stats.bytesRemoved)}</span>
              {stats.notVerified > 0 && <span>{t('removal.notVerified', { count: n(stats.notVerified) })}</span>}
              {stats.noChecksum > 0 && <span>{t('removal.noChecksumDone', { count: n(stats.noChecksum) })}</span>}
              {stats.changedOnServer > 0 && (
                <span>{t('removal.changedOnServer', { count: n(stats.changedOnServer) })}</span>
              )}
              {stats.alreadyGone > 0 && <span>{t('removal.alreadyGone', { count: n(stats.alreadyGone) })}</span>}
              {stats.skippedFolders > 0 && (
                <span>{t('removal.skippedFolders', { count: n(stats.skippedFolders) })}</span>
              )}
            </div>

            {progress.phase === 'done' && (
              <div className="flex items-center gap-2" style={{ color: 'var(--ok)' }}>
                <CircleCheck size={15} />
                {t('removal.done')}
              </div>
            )}

            {progress.error && <div style={{ color: 'var(--danger)' }}>{progress.error}</div>}
          </div>
        )}
      </div>
    </Modal>
  );
}

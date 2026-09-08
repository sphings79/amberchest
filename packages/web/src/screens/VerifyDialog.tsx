import type { AccountOverview, Finding, VerifyProgress } from '@mail-archiver/core';
import { CircleAlert, CircleCheck, FileQuestion, ShieldCheck, Square, TableOfContents } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client.js';
import { Button, Modal, ProgressBar, Toggle } from '../components/ui.js';
import { useApp } from '../state.js';
import { formatBytes } from './Overview.js';

const ICONS: Record<Finding['kind'], ReactNode> = {
  missing: <CircleAlert size={14} />,
  unreadable: <CircleAlert size={14} />,
  changed: <CircleAlert size={14} />,
  orphan: <FileQuestion size={14} />,
  'folder-differs': <CircleAlert size={14} />,
};

/**
 * Checks one archive: every file against its checksum, every file against the
 * index, and on request the folders against the server.
 */
export function VerifyDialog({
  overview,
  onClose,
}: {
  overview: AccountOverview;
  onClose: () => void;
}): ReactNode {
  const { t } = useTranslation();
  const { verifyProgress } = useApp();
  const accountId = overview.account.id;

  const [checkServer, setCheckServer] = useState(false);
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [stored, setStored] = useState<VerifyProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [register, setRegister] = useState<{ folders: number; messages: number } | null>(null);

  // The live event wins; the stored result is what is left from last time.
  const progress = verifyProgress[accountId] ?? stored;
  const running = progress ? !['done', 'failed', 'cancelled'].includes(progress.phase) : false;

  useEffect(() => {
    void api
      .lastVerify(accountId)
      .then((value) => setStored(value.run))
      .catch(() => undefined);
  }, [accountId]);

  const start = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api.startVerify(accountId, { checkServer, includeDeleted });
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const stats = progress?.stats;
  const clean =
    stats !== undefined &&
    stats.missing === 0 &&
    stats.unreadable === 0 &&
    stats.changed === 0 &&
    stats.orphans === 0 &&
    stats.foldersDiffering === 0;

  const ratio =
    stats && stats.messagesTotal > 0 ? stats.messagesChecked / stats.messagesTotal : 0;

  return (
    <Modal
      open
      onClose={onClose}
      title={t('verify.title', { name: overview.account.name })}
      footer={
        <div className="flex items-center gap-2">
          <Button onClick={onClose}>{t('common.close')}</Button>
          {running ? (
            <Button variant="danger" onClick={() => void api.cancelVerify(accountId)}>
              <Square size={14} />
              {t('verify.cancel')}
            </Button>
          ) : (
            <Button variant="primary" disabled={busy} onClick={() => void start()}>
              <ShieldCheck size={15} />
              {t('verify.start')}
            </Button>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          {t('verify.intro')}
        </p>

        <Toggle
          checked={checkServer}
          onChange={setCheckServer}
          label={t('verify.checkServer')}
          hint={t('verify.checkServerHint')}
        />
        <div className="flex flex-wrap items-center gap-2 rounded-xl p-3" style={{ background: 'var(--surface-2)' }}>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium">{t('register.title')}</div>
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {t('register.hint')}
            </div>
          </div>
          <Button
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setError(null);
              void api
                .writeRegister(accountId)
                .then((value) => setRegister(value))
                .catch((cause: Error) => setError(cause.message))
                .finally(() => setBusy(false));
            }}
          >
            <TableOfContents size={15} />
            {t('register.write')}
          </Button>
          {register && (
            <span className="w-full text-xs" style={{ color: 'var(--ok)' }}>
              {t('register.done', { folders: register.folders, messages: register.messages })}
            </span>
          )}
        </div>

        <Toggle
          checked={includeDeleted}
          onChange={setIncludeDeleted}
          label={t('verify.includeDeleted')}
          hint={t('verify.includeDeletedHint')}
        />

        {error && (
          <div className="rounded-xl px-3 py-2 text-xs" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>
            {error}
          </div>
        )}

        {progress && stats && (
          <div className="flex flex-col gap-3 rounded-xl p-3" style={{ background: 'var(--surface-2)' }}>
            <div className="flex items-center gap-2 text-xs">
              <span style={{ color: 'var(--text-muted)' }}>{t(`verify.phase.${progress.phase}`)}</span>
              {progress.currentFolder && (
                <span className="truncate" style={{ color: 'var(--text-faint)' }}>
                  {progress.currentFolder}
                </span>
              )}
              <span className="ml-auto tabular-nums" style={{ color: 'var(--text-faint)' }}>
                {stats.messagesChecked} / {stats.messagesTotal}
              </span>
            </div>

            {running && <ProgressBar value={ratio} indeterminate={stats.messagesTotal === 0} />}

            <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
              <Number label={t('verify.checked')} value={stats.messagesChecked} />
              <Number label={t('verify.missing')} value={stats.missing} bad={stats.missing > 0} />
              <Number label={t('verify.changed')} value={stats.changed} bad={stats.changed > 0} />
              <Number label={t('verify.unreadable')} value={stats.unreadable} bad={stats.unreadable > 0} />
              <Number label={t('verify.orphans')} value={stats.orphans} bad={stats.orphans > 0} />
              <Number label={t('verify.hashesAdded')} value={stats.hashesAdded} />
              {stats.foldersCompared > 0 && (
                <>
                  <Number label={t('verify.serverMessages')} value={stats.serverMessages} />
                  <Number label={t('verify.localMessages')} value={stats.localMessages} />
                  <Number
                    label={t('verify.foldersDiffering')}
                    value={stats.foldersDiffering}
                    bad={stats.foldersDiffering > 0}
                  />
                </>
              )}
            </div>

            <div className="text-xs" style={{ color: 'var(--text-faint)' }}>
              {t('verify.bytesChecked', { size: formatBytes(stats.bytesChecked) })}
            </div>

            {!running && clean && (
              <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--ok)' }}>
                <CircleCheck size={15} />
                {t('verify.clean')}
              </div>
            )}

            {progress.findings.length > 0 && (
              <div className="flex max-h-64 flex-col gap-1.5 overflow-y-auto">
                {progress.findings.map((finding, index) => (
                  <div
                    key={index}
                    className="flex items-start gap-2 rounded-lg px-2.5 py-1.5 text-xs"
                    style={{
                      background: 'var(--surface-1)',
                      color: finding.kind === 'orphan' ? 'var(--warn)' : 'var(--danger)',
                    }}
                  >
                    {ICONS[finding.kind]}
                    <div className="min-w-0">
                      <div className="truncate" style={{ color: 'var(--text)' }}>
                        {t(`verify.kind.${finding.kind}`)} · {finding.path}
                      </div>
                      <div style={{ color: 'var(--text-faint)' }}>
                        {t(`verify.detail.${finding.detail}`, { ...finding.detailParams })}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {progress.error && (
              <div className="text-xs" style={{ color: 'var(--danger)' }}>
                {progress.error}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

function Number({ label, value, bad }: { label: string; value: number; bad?: boolean }): ReactNode {
  return (
    <div className="rounded-lg px-2.5 py-2" style={{ background: 'var(--surface-1)' }}>
      <div style={{ color: 'var(--text-faint)' }}>{label}</div>
      <div
        className="text-sm font-medium tabular-nums"
        style={{ color: bad ? 'var(--danger)' : 'var(--text)' }}
      >
        {value}
      </div>
    </div>
  );
}

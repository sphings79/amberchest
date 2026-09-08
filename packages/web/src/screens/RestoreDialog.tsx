import type { AccountOverview } from '@mail-archiver/core';
import { AlertTriangle, PlugZap, Upload } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type RestoreTarget } from '../api/client.js';
import { Badge, Button, Field, Input, Modal, ProgressBar, Select, Toggle } from '../components/ui.js';
import { useApp } from '../state.js';

interface Mapping {
  source: string;
  target: string;
}

/**
 * Restores archived messages to a mail server.
 *
 * Two cases: putting back what was lost on the same account, or moving to a
 * different provider. Both use the same folder mapping, which is proposed from
 * the special use markers and can be corrected by hand.
 */
export function RestoreDialog({
  overview,
  onClose,
}: {
  overview: AccountOverview;
  onClose: () => void;
}): ReactNode {
  const { t } = useTranslation();
  const { restoreProgress } = useApp();
  const account = overview.account;

  const [sameAccount, setSameAccount] = useState(true);
  const [target, setTarget] = useState<RestoreTarget>({
    host: account.host,
    port: account.port,
    security: account.security,
    rejectUnauthorized: account.rejectUnauthorized,
    username: account.username,
    password: '',
    useAccountId: account.id,
  });

  const [mappings, setMappings] = useState<Mapping[] | null>(null);
  const [targetFolders, setTargetFolders] = useState<string[]>([]);
  const [skipExisting, setSkipExisting] = useState(true);
  const [restoreFlags, setRestoreFlags] = useState(true);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const running = restoreProgress
    ? !['done', 'failed', 'cancelled'].includes(restoreProgress.phase)
    : false;

  /** For the same account the stored password is used, never re-typed. */
  const effectiveTarget = (): RestoreTarget =>
    sameAccount
      ? {
          host: account.host,
          port: account.port,
          security: account.security,
          rejectUnauthorized: account.rejectUnauthorized,
          username: account.username,
          password: '',
          useAccountId: account.id,
        }
      : { ...target, useAccountId: undefined };

  const connect = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.restoreMappings({ accountId: account.id, target: effectiveTarget() });
      setMappings(result.mappings);
      setTargetFolders(result.targetFolders);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const start = async (): Promise<void> => {
    if (!mappings) return;
    setError(null);
    try {
      await api.startRestore({
        accountId: account.id,
        target: effectiveTarget(),
        mappings,
        selection: {
          query: '',
          folders: [],
          dateFrom: dateFrom || null,
          dateTo: dateTo || null,
          from: null,
          withAttachments: false,
        },
        skipExisting,
        restoreFlags,
      });
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  const activeCount = mappings?.filter((mapping) => mapping.target.trim() !== '').length ?? 0;

  return (
    <Modal
      open
      wide
      title={`${t('restore.title')} - ${account.name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('account.cancel')}
          </Button>
          {running ? (
            <Button onClick={() => void api.cancelRestore()}>{t('restore.cancel')}</Button>
          ) : (
            <Button variant="primary" disabled={!mappings || activeCount === 0} onClick={() => void start()}>
              <Upload size={15} />
              {t('restore.start')}
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div
          className="flex items-start gap-2 rounded-xl px-3 py-2 text-xs"
          style={{ background: 'var(--warn-soft)', color: 'var(--warn)' }}
        >
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          {t('restore.warning')}
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
            {t('restore.targetTitle')}
          </span>
          <div className="flex gap-2">
            {[
              { value: true, label: t('restore.sameAccount') },
              { value: false, label: t('restore.otherServer') },
            ].map((option) => (
              <button
                key={String(option.value)}
                type="button"
                onClick={() => {
                  setSameAccount(option.value);
                  setMappings(null);
                }}
                className="flex-1 rounded-xl border px-3 py-2 text-sm transition"
                style={{
                  background: sameAccount === option.value ? 'var(--accent-soft)' : 'var(--surface-2)',
                  borderColor: sameAccount === option.value ? 'var(--accent)' : 'var(--border)',
                  color: sameAccount === option.value ? 'var(--accent)' : 'var(--text-muted)',
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {!sameAccount && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t('restore.host')}>
              <Input value={target.host} onChange={(event) => setTarget({ ...target, host: event.target.value })} />
            </Field>
            <Field label={t('restore.port')}>
              <Input
                type="number"
                value={target.port}
                onChange={(event) => setTarget({ ...target, port: Number(event.target.value) })}
              />
            </Field>
            <Field label={t('restore.security')}>
              <Select
                value={target.security}
                onChange={(event) =>
                  setTarget({ ...target, security: event.target.value as RestoreTarget['security'] })
                }
              >
                <option value="tls">SSL/TLS</option>
                <option value="starttls">STARTTLS</option>
                <option value="none">{t('account.securityNone')}</option>
              </Select>
            </Field>
            <Field label={t('restore.username')}>
              <Input
                value={target.username}
                onChange={(event) => setTarget({ ...target, username: event.target.value })}
              />
            </Field>
            <Field label={t('restore.password')}>
              <Input
                type="password"
                autoComplete="new-password"
                value={target.password}
                onChange={(event) => setTarget({ ...target, password: event.target.value })}
              />
            </Field>
          </div>
        )}

        <Button onClick={() => void connect()} disabled={busy || running}>
          <PlugZap size={15} />
          {busy ? t('restore.connecting') : t('restore.connect')}
        </Button>

        {mappings && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                {t('restore.mappingTitle')}
              </span>
              <Badge tone="accent">{activeCount}</Badge>
            </div>
            <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
              {t('restore.mappingHint')}
            </p>

            <div className="max-h-64 overflow-y-auto rounded-xl border">
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ color: 'var(--text-faint)' }}>
                    <th className="px-3 py-2 text-left font-medium">{t('restore.sourceFolder')}</th>
                    <th className="px-3 py-2 text-left font-medium">{t('restore.targetFolder')}</th>
                  </tr>
                </thead>
                <tbody>
                  {mappings.map((mapping, index) => {
                    const isNew = mapping.target.trim() !== '' && !targetFolders.includes(mapping.target);
                    return (
                      <tr key={mapping.source} style={{ borderTop: '1px solid var(--border)' }}>
                        <td className="max-w-[220px] truncate px-3 py-1.5">{mapping.source}</td>
                        <td className="px-3 py-1.5">
                          <div className="flex items-center gap-2">
                            <Input
                              value={mapping.target}
                              disabled={running}
                              onChange={(event) => {
                                const next = [...mappings];
                                next[index] = { ...mapping, target: event.target.value };
                                setMappings(next);
                              }}
                              className="!py-1 !text-xs"
                            />
                            {isNew && <Badge tone="warn">{t('restore.willCreate')}</Badge>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-3 rounded-2xl border p-4" style={{ background: 'var(--surface-2)' }}>
          <span className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
            {t('restore.options')}
          </span>
          <Toggle
            checked={skipExisting}
            onChange={setSkipExisting}
            label={t('restore.skipExisting')}
            hint={t('restore.skipExistingHint')}
          />
          <Toggle checked={restoreFlags} onChange={setRestoreFlags} label={t('restore.restoreFlags')} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t('restore.dateFrom')}>
              <Input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
            </Field>
            <Field label={t('restore.dateTo')}>
              <Input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
            </Field>
          </div>
        </div>

        {restoreProgress && (
          <div className="flex flex-col gap-2 rounded-xl p-3" style={{ background: 'var(--surface-2)' }}>
            <div className="flex items-center gap-2 text-xs">
              <span className="font-medium">{t(`restore.phase.${restoreProgress.phase}`)}</span>
              {restoreProgress.currentFolder && running && (
                <span className="truncate" style={{ color: 'var(--text-faint)' }}>
                  {restoreProgress.currentFolder}
                </span>
              )}
              <span className="ml-auto tabular-nums" style={{ color: 'var(--text-faint)' }}>
                {restoreProgress.stats.messagesDone} / {restoreProgress.stats.messagesTotal}
              </span>
            </div>
            <ProgressBar
              value={
                restoreProgress.stats.messagesTotal > 0
                  ? restoreProgress.stats.messagesDone / restoreProgress.stats.messagesTotal
                  : 0
              }
              indeterminate={running && restoreProgress.stats.messagesTotal === 0}
            />
            <div className="flex flex-wrap gap-3 text-xs" style={{ color: 'var(--text-muted)' }}>
              <span>
                <strong className="tabular-nums">{restoreProgress.stats.messagesUploaded}</strong>{' '}
                {t('restore.stats.uploaded')}
              </span>
              <span>
                <strong className="tabular-nums">{restoreProgress.stats.messagesSkipped}</strong>{' '}
                {t('restore.stats.skipped')}
              </span>
              <span>
                <strong className="tabular-nums">{restoreProgress.stats.foldersCreated}</strong>{' '}
                {t('restore.stats.created')}
              </span>
              {restoreProgress.stats.messagesFailed > 0 && (
                <span style={{ color: 'var(--danger)' }}>
                  <strong className="tabular-nums">{restoreProgress.stats.messagesFailed}</strong>{' '}
                  {t('restore.stats.failed')}
                </span>
              )}
            </div>
            {restoreProgress.error && (
              <span className="text-xs" style={{ color: 'var(--danger)' }}>
                {restoreProgress.error}
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

import type { AccountOverview, PassiveWarning } from '@amberchest/core';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client.js';
import { Button, Modal } from '../components/ui.js';

/**
 * Switches an account to a passive archive.
 *
 * Asks the server first whether the last backup is missing, unfinished or old,
 * because a passive account is never contacted again and nothing can be made
 * up afterwards.
 */
export function PassiveDialog({
  overview,
  onClose,
  onChanged,
}: {
  overview: AccountOverview;
  onClose: () => void;
  onChanged: () => void;
}): ReactNode {
  const { t } = useTranslation();
  const account = overview.account;
  const [check, setCheck] = useState<{ warning: PassiveWarning | null; running: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncStarted, setSyncStarted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .passiveCheck(account.id)
      .then((result) => {
        if (!cancelled) setCheck(result);
      })
      .catch((caught: Error) => {
        if (!cancelled) setError(caught.message);
      });
    return () => {
      cancelled = true;
    };
  }, [account.id]);

  const run = async (body: { force?: boolean; afterSync?: boolean }): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.setPassive(account.id, { passive: true, ...body });
      onChanged();
      if (result.started) setSyncStarted(true);
      else onClose();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const warning = check?.warning ?? null;
  const warningText = (value: PassiveWarning): string => {
    if (value.reason === 'never') return t('passive.never');
    if (value.reason === 'stale') return t('passive.stale', { days: value.days });
    const base = t('passive.notDone', { status: value.status });
    return value.error ? `${base} ${t('passive.notDoneError', { error: value.error })}` : base;
  };

  const footer = syncStarted ? (
    <Button variant="primary" onClick={onClose}>
      {t('passive.close')}
    </Button>
  ) : (
    <>
      <Button onClick={onClose} disabled={busy}>
        {t('passive.cancel')}
      </Button>
      {check && !check.running && warning && (
        <>
          <Button onClick={() => void run({ force: true })} disabled={busy}>
            {t('passive.force')}
          </Button>
          <Button variant="primary" onClick={() => void run({ afterSync: true })} disabled={busy}>
            {t('passive.syncFirst')}
          </Button>
        </>
      )}
      {check && !check.running && !warning && (
        <Button variant="primary" onClick={() => void run({})} disabled={busy}>
          {t('passive.confirm')}
        </Button>
      )}
    </>
  );

  return (
    <Modal open title={t('passive.title', { name: account.name })} onClose={onClose} footer={footer}>
      <div className="flex flex-col gap-3 text-xs leading-relaxed">
        <p style={{ color: 'var(--text-muted)' }}>{t('passive.intro')}</p>
        <p style={{ color: 'var(--text-muted)' }}>{t('passive.keeps')}</p>

        {!check && !error && <p style={{ color: 'var(--text-faint)' }}>{t('passive.checking')}</p>}

        {check?.running && (
          <p className="rounded-xl px-3 py-2" style={{ background: 'var(--warn-soft)', color: 'var(--warn)' }}>
            {t('passive.running')}
          </p>
        )}

        {check && !check.running && warning && (
          <div className="rounded-xl px-3 py-2" style={{ background: 'var(--warn-soft)', color: 'var(--warn)' }}>
            <p className="font-medium">{warningText(warning)}</p>
            <p className="mt-1">{t('passive.consequence')}</p>
          </div>
        )}

        {syncStarted && (
          <p className="rounded-xl px-3 py-2" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
            {t('passive.syncStarted')}
          </p>
        )}

        {error && (
          <p className="rounded-xl px-3 py-2" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

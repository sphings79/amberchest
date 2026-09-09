import type { AccountOverview, TransferProgress } from '@amberchest/core';
import { ArrowRightLeft, CircleCheck, Square, TriangleAlert } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client.js';
import { getConnectionToken, listConnections, type Connection } from '../api/connections.js';
import { Button, Field, Input, Modal, ProgressBar, Select, Toggle } from '../components/ui.js';
import { useApp } from '../state.js';
import { formatBytes } from './Overview.js';

interface RemoteAccount {
  id: string;
  name: string;
  email: string;
  messages: number;
}

/**
 * Moves an archive to another instance.
 *
 * The files travel, the index does not: the other side rebuilds it from the
 * journals. Nothing is deleted here afterwards - removing the local copy is a
 * decision for a person, once the other side has been looked at.
 */
export function TransferDialog({
  overview,
  onClose,
}: {
  overview: AccountOverview;
  onClose: () => void;
}): ReactNode {
  const { t } = useTranslation();
  const { transferProgress } = useApp();

  const connections = listConnections();
  const [connectionId, setConnectionId] = useState(connections[0]?.id ?? '');
  const [url, setUrl] = useState(connections[0]?.url ?? '');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  const [accounts, setAccounts] = useState<RemoteAccount[] | null>(null);
  const [targetId, setTargetId] = useState('');
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const progress = transferProgress;
  const running = progress ? !['done', 'failed', 'cancelled'].includes(progress.phase) : false;

  useEffect(() => {
    const connection = connections.find((entry: Connection) => entry.id === connectionId);
    if (!connection) return;
    setUrl(connection.url);
    setToken(getConnectionToken(connection.id) ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId]);

  /** Asks the other side who lives there, which also proves the token works. */
  const connect = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      let bearer = token;
      if (!bearer && password) {
        const login = await fetch(`${url.replace(/\/+$/, '')}/api/login`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ password }),
        });
        if (!login.ok) throw new Error(t('transfer.loginFailed'));
        bearer = ((await login.json()) as { token: string }).token;
        setToken(bearer);
      }

      const response = await fetch(`${url.replace(/\/+$/, '')}/api/accounts`, {
        headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const payload = (await response.json()) as AccountOverview[];
      const list = payload.map((entry) => ({
        id: entry.account.id,
        name: entry.account.name,
        email: entry.account.email,
        messages: entry.messageCount,
      }));
      setAccounts(list);
      // The obvious candidate is the account with the same address.
      const match = list.find((entry) => entry.email === overview.account.email);
      setTargetId(match?.id ?? list[0]?.id ?? '');
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const start = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api.startTransfer(overview.account.id, {
        url,
        token,
        accountId: targetId,
        includeDeleted,
      });
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const stats = progress?.stats;
  const ratio = stats && stats.bytesTotal > 0 ? stats.bytesSent / stats.bytesTotal : 0;
  const target = accounts?.find((entry) => entry.id === targetId);

  return (
    <Modal
      open
      onClose={onClose}
      title={t('transfer.title', { name: overview.account.name })}
      footer={
        <div className="flex items-center gap-2">
          <Button onClick={onClose}>{t('common.close')}</Button>
          {running ? (
            <Button variant="danger" onClick={() => void api.cancelTransfer(overview.account.id)}>
              <Square size={14} />
              {t('transfer.cancel')}
            </Button>
          ) : (
            <Button
              variant="primary"
              disabled={busy || !url || !targetId}
              onClick={() => void start()}
            >
              <ArrowRightLeft size={15} />
              {t('transfer.start')}
            </Button>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          {t('transfer.intro', {
            messages: overview.messageCount,
            size: formatBytes(overview.bytes),
          })}
        </p>

        {connections.length > 0 && (
          <Field label={t('transfer.connection')}>
            <Select value={connectionId} onChange={(event) => setConnectionId(event.target.value)}>
              {connections.map((entry: Connection) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name} — {entry.url}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <Field label={t('transfer.url')} hint={t('transfer.urlHint')}>
          <Input value={url} placeholder="http://nas:8484" onChange={(event) => setUrl(event.target.value)} />
        </Field>

        {!token && (
          <Field label={t('transfer.password')} hint={t('transfer.passwordHint')}>
            <Input
              type="password"
              value={password}
              autoComplete="new-password"
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={busy || !url} onClick={() => void connect()}>
            {t('transfer.load')}
          </Button>
          {accounts && (
            <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
              {t('transfer.found', { count: accounts.length })}
            </span>
          )}
        </div>

        {accounts && accounts.length > 0 && (
          <Field label={t('transfer.target')} hint={t('transfer.targetHint')}>
            <Select value={targetId} onChange={(event) => setTargetId(event.target.value)}>
              {accounts.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name} — {entry.email} ({entry.messages})
                </option>
              ))}
            </Select>
          </Field>
        )}

        {accounts && accounts.length === 0 && (
          <div className="rounded-xl px-3 py-2 text-xs" style={{ background: 'var(--warn-soft)', color: 'var(--warn)' }}>
            {t('transfer.noAccounts')}
          </div>
        )}

        {target && target.messages > 0 && (
          <div className="flex items-start gap-2 rounded-xl px-3 py-2 text-xs" style={{ background: 'var(--warn-soft)', color: 'var(--warn)' }}>
            <TriangleAlert size={14} />
            {t('transfer.targetNotEmpty', { count: target.messages })}
          </div>
        )}

        <Toggle
          checked={includeDeleted}
          onChange={setIncludeDeleted}
          label={t('transfer.includeDeleted')}
          hint={t('transfer.includeDeletedHint')}
        />

        {error && (
          <div className="rounded-xl px-3 py-2 text-xs" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>
            {error}
          </div>
        )}

        {progress && stats && (
          <div className="flex flex-col gap-2 rounded-xl p-3" style={{ background: 'var(--surface-2)' }}>
            <div className="flex items-center gap-2 text-xs">
              <span style={{ color: 'var(--text-muted)' }}>{t(`transfer.phase.${progress.phase}`)}</span>
              {progress.currentFile && (
                <span className="truncate" style={{ color: 'var(--text-faint)' }}>
                  {progress.currentFile}
                </span>
              )}
              <span className="ml-auto tabular-nums" style={{ color: 'var(--text-faint)' }}>
                {stats.filesSent + stats.filesSkipped} / {stats.filesTotal}
              </span>
            </div>

            {running && <ProgressBar value={ratio} indeterminate={stats.bytesTotal === 0} />}

            <div className="text-xs" style={{ color: 'var(--text-faint)' }}>
              {t('transfer.sent', {
                sent: stats.filesSent,
                skipped: stats.filesSkipped,
                failed: stats.filesFailed,
                size: formatBytes(stats.bytesSent),
              })}
            </div>

            {progress.phase === 'done' && (
              <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--ok)' }}>
                <CircleCheck size={15} />
                {t('transfer.done', {
                  adopted:
                    (progress.adopted?.messagesAdopted ?? 0) +
                    (progress.adopted?.messagesRebuilt ?? 0),
                })}
              </div>
            )}

            {progress.error && (
              <div className="text-xs" style={{ color: 'var(--danger)' }}>
                {progress.error}
              </div>
            )}
          </div>
        )}

        {progress?.phase === 'done' && (
          <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
            {t('transfer.afterwards')}
          </p>
        )}
      </div>
    </Modal>
  );
}

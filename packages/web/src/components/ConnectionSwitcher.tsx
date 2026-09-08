import { Check, ChevronsUpDown, Cloud, Laptop, Plus, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { api, getConnection, useConnection } from '../api/client.js';
import {
  LOCAL_CONNECTION,
  listConnections,
  normaliseUrl,
  saveConnections,
  setConnectionToken,
  type Connection,
} from '../api/connections.js';
import { Button, Field, Input, Modal, cx } from './ui.js';

/**
 * Switches which instance the interface operates.
 *
 * The desktop app talks to its own local server by default, but it can drive a
 * container elsewhere just as well - useful when the scheduled backups run on
 * a server and you want to look at them from the Mac.
 */
export function ConnectionSwitcher(): ReactNode {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [connections, setConnections] = useState<Connection[]>(() => listConnections());
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const active = getConnection();

  const switchTo = (connection: Connection): void => {
    useConnection(connection);
    // A full reload is the honest way to start over against another instance:
    // every cached account, progress and log entry belongs to the old one.
    window.location.reload();
  };

  const add = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const base = normaliseUrl(url);

    try {
      // Check that something is actually listening before storing anything.
      const health = await fetch(`${base}/api/health`);
      if (!health.ok) throw new Error(`${health.status} ${health.statusText}`);

      const connection: Connection = {
        id: `remote-${Date.now()}`,
        name: name.trim() || base.replace(/^https?:\/\//, ''),
        url: base,
      };

      if (password) {
        const login = await fetch(`${base}/api/login`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ password }),
        });
        if (!login.ok) throw new Error(t('connections.wrongPassword'));
        const { token } = (await login.json()) as { token: string };
        setConnectionToken(connection.id, token);
      }

      const next = [...connections, connection];
      saveConnections(next);
      setConnections(next);
      setAdding(false);
      setName('');
      setUrl('');
      setPassword('');
      switchTo(connection);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = (connection: Connection): void => {
    const next = connections.filter((entry) => entry.id !== connection.id);
    saveConnections(next);
    setConnections(next);
    setConnectionToken(connection.id, null);
    if (active.id === connection.id) switchTo(LOCAL_CONNECTION);
  };

  const entries = [{ ...LOCAL_CONNECTION, name: t('connections.local') }, ...connections];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={t('connections.buttonHint')}
        className="flex w-full items-center gap-2 rounded-xl border px-2.5 py-2 text-left transition hover:bg-[var(--surface-2)]"
        style={{ borderColor: 'var(--border)' }}
      >
        <span style={{ color: active.url ? 'var(--accent)' : 'var(--text-muted)' }}>
          {active.url ? <Cloud size={15} /> : <Laptop size={15} />}
        </span>
        <span className="hidden min-w-0 flex-1 flex-col md:flex">
          <span className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>
            {t('connections.label')}
          </span>
          <span className="truncate text-xs" style={{ color: 'var(--text)' }}>
            {active.url ? active.name : t('connections.local')}
          </span>
        </span>
        <ChevronsUpDown size={13} className="hidden md:block" style={{ color: 'var(--text-faint)' }} />
      </button>

      <Modal open={open} title={t('connections.title')} onClose={() => setOpen(false)}>
        <div className="flex flex-col gap-3">
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {t('connections.hint')}
          </p>

          {entries.map((connection) => {
            const isActive = connection.id === active.id;
            return (
              <div
                key={connection.id}
                className={cx('flex items-center gap-2 rounded-xl border p-3')}
                style={{
                  background: isActive ? 'var(--accent-soft)' : 'var(--surface-2)',
                  borderColor: isActive ? 'var(--accent)' : 'var(--border)',
                }}
              >
                <span style={{ color: isActive ? 'var(--accent)' : 'var(--text-muted)' }}>
                  {connection.url ? <Cloud size={16} /> : <Laptop size={16} />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{connection.name}</div>
                  {connection.url && (
                    <div className="truncate text-xs" style={{ color: 'var(--text-faint)' }}>
                      {connection.url}
                    </div>
                  )}
                </div>

                {isActive ? (
                  <Check size={16} style={{ color: 'var(--accent)' }} />
                ) : (
                  <Button onClick={() => switchTo(connection)}>{t('connections.use')}</Button>
                )}

                {connection.url && (
                  <Button variant="ghost" onClick={() => remove(connection)} aria-label={t('connections.remove')}>
                    <Trash2 size={14} style={{ color: 'var(--danger)' }} />
                  </Button>
                )}
              </div>
            );
          })}

          {adding ? (
            <div className="animate-fade-up flex flex-col gap-3 rounded-xl border p-3" style={{ background: 'var(--surface-2)' }}>
              <Field label={t('connections.name')}>
                <Input value={name} placeholder="Unraid" onChange={(event) => setName(event.target.value)} />
              </Field>
              <Field label={t('connections.url')} hint={t('connections.urlHint')}>
                <Input
                  value={url}
                  placeholder="http://192.168.1.10:8484"
                  onChange={(event) => setUrl(event.target.value)}
                />
              </Field>
              <Field label={t('connections.password')} hint={t('connections.passwordHint')}>
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </Field>

              {error && (
                <div className="rounded-xl px-3 py-2 text-xs" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>
                  {error}
                </div>
              )}

              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setAdding(false)}>
                  {t('account.cancel')}
                </Button>
                <Button variant="primary" disabled={busy || url.trim() === ''} onClick={() => void add()}>
                  {t('connections.add')}
                </Button>
              </div>
            </div>
          ) : (
            <Button onClick={() => setAdding(true)}>
              <Plus size={15} />
              {t('connections.addServer')}
            </Button>
          )}
        </div>
      </Modal>
    </>
  );
}

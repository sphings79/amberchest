import { KeyRound, Lock, ShieldCheck } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { api, setToken } from '../api/client.js';
import { ConnectionSwitcher } from '../components/ConnectionSwitcher.js';
import { Button, Card, Field, Input } from '../components/ui.js';
import { useApp } from '../state.js';

type Mode = 'login' | 'setup' | 'unlock';

/**
 * Everything that stands between the user and the accounts: the optional web
 * password, the initial master password, and unlocking an existing config.
 */
export function GateScreen(): ReactNode {
  const { t } = useTranslation();
  const { server, refreshState } = useApp();

  const mode: Mode = !server?.authenticated ? 'login' : !server.initialized ? 'setup' : 'unlock';

  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);

    if (mode === 'setup') {
      if (password.length < 8) {
        setError(t('gate.tooShort'));
        return;
      }
      if (password !== repeat) {
        setError(t('gate.mismatch'));
        return;
      }
    }

    setBusy(true);
    try {
      if (mode === 'login') {
        const result = await api.login(password);
        setToken(result.token);
      } else if (mode === 'setup') {
        await api.setup(password);
      } else {
        await api.unlock(password);
      }
      setPassword('');
      setRepeat('');
      await refreshState();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const titles: Record<Mode, { title: string; hint: string; action: string; icon: ReactNode }> = {
    login: { title: t('gate.loginTitle'), hint: t('gate.loginHint'), action: t('gate.login'), icon: <KeyRound size={20} /> },
    setup: { title: t('gate.setupTitle'), hint: t('gate.setupHint'), action: t('gate.create'), icon: <ShieldCheck size={20} /> },
    unlock: { title: t('gate.unlockTitle'), hint: t('gate.unlockHint'), action: t('gate.unlock'), icon: <Lock size={20} /> },
  };
  const current = titles[mode];

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto p-6" style={{ background: 'var(--surface-0)' }}>
      <div className="animate-fade-up w-full max-w-md">
        <div className="mb-7 flex flex-col items-center gap-3 text-center">
          <div
            className="flex h-14 w-14 items-center justify-center rounded-2xl text-xl"
            style={{ background: 'var(--accent)', color: 'var(--accent-text)', boxShadow: 'var(--shadow-lg)' }}
          >
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M3 7.5 12 13l9-5.5" strokeLinecap="round" strokeLinejoin="round" />
              <rect x="3" y="5" width="18" height="14" rx="2.5" />
              <path d="M7 17h5" strokeLinecap="round" />
            </svg>
          </div>
          <div>
            <div className="text-lg font-semibold tracking-tight">{t('app.name')}</div>
            <div className="text-xs" style={{ color: 'var(--text-faint)' }}>
              {t('app.tagline')}
            </div>
          </div>
        </div>

        <Card className="flex flex-col gap-4">
          <div className="flex items-center gap-2.5">
            <span
              className="flex h-9 w-9 items-center justify-center rounded-xl"
              style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
            >
              {current.icon}
            </span>
            <div>
              <div className="text-sm font-semibold">{current.title}</div>
            </div>
          </div>

          <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
            {current.hint}
          </p>

          {mode === 'setup' && (
            <p
              className="rounded-xl px-3 py-2 text-xs"
              style={{ background: 'var(--warn-soft)', color: 'var(--warn)' }}
            >
              {t('gate.setupWarning')}
            </p>
          )}

          <form className="flex flex-col gap-3" onSubmit={submit}>
            <Field label={mode === 'login' ? t('gate.password') : t('gate.masterPassword')}>
              <Input
                type="password"
                autoFocus
                autoComplete={mode === 'setup' ? 'new-password' : 'current-password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </Field>

            {mode === 'setup' && (
              <Field label={t('gate.repeatPassword')}>
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={repeat}
                  onChange={(event) => setRepeat(event.target.value)}
                />
              </Field>
            )}

            {error && (
              <div className="rounded-xl px-3 py-2 text-xs" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>
                {error}
              </div>
            )}

            <Button type="submit" variant="primary" disabled={busy || password.length === 0} className="mt-1 w-full">
              {current.action}
            </Button>
          </form>
        </Card>

        <div className="mt-4 flex justify-center">
          <ConnectionSwitcher />
        </div>
      </div>
    </div>
  );
}

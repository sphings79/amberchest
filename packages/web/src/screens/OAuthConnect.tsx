import { Check, Copy, ExternalLink, KeyRound, Loader2, RefreshCw } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { api, isDesktop } from '../api/client.js';
import { Button, Field, Input, Select } from '../components/ui.js';

type ProviderId = 'google' | 'microsoft' | 'custom';

interface ProviderInfo {
  id: ProviderId;
  name: string;
  deviceFlow: boolean;
  imapHost: string;
  imapPort: number;
  configured: boolean;
}

/** The desktop app can catch the redirect itself; the browser cannot. */
interface DesktopBridge {
  oauthLoopback?: (url: string, port: number) => Promise<string>;
  suggestPort?: () => Promise<number>;
}

function bridge(): DesktopBridge | null {
  const value = (window as unknown as { mailArchiver?: DesktopBridge }).mailArchiver;
  return value ?? null;
}

/**
 * Connects one account to a provider.
 *
 * Three ways in, because not everyone has an address the provider can reach:
 * a device code typed in on another machine, a loopback redirect the desktop
 * app catches by itself, and the same loopback address copied back by hand.
 */
export function OAuthConnect({
  accountId,
  connected,
  onConnected,
  onProviderPicked,
}: {
  /** Null while the account has not been saved yet. */
  accountId: string | null;
  connected: boolean;
  onConnected: () => void;
  onProviderPicked: (provider: ProviderInfo) => void;
}): ReactNode {
  const { t } = useTranslation();
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [provider, setProvider] = useState<ProviderId>('google');
  const [redirectMode, setRedirectMode] = useState<'loopback' | 'public'>('loopback');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(connected);

  // Device flow
  const [device, setDevice] = useState<{ userCode: string; uri: string; complete: string | null } | null>(null);
  // Browser flow
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [state, setState] = useState<string | null>(null);
  const [pasted, setPasted] = useState('');

  useEffect(() => {
    void api
      .oauthProviders()
      .then((value) => {
        setProviders(value.providers);
        setRedirectMode(value.redirectMode);
        const first = value.providers.find((entry) => entry.configured) ?? value.providers[0];
        if (first) {
          setProvider(first.id);
          onProviderPicked(first);
        }
      })
      .catch((cause: Error) => setError(cause.message));
    // The list does not change while the dialog is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = providers.find((entry) => entry.id === provider);

  // While a device code is outstanding, ask now and then whether it was used.
  useEffect(() => {
    if (!device || !accountId || done) return;
    const timer = window.setInterval(() => {
      void api
        .oauthDeviceStatus(accountId)
        .then((status) => {
          if (status.error) setError(status.error);
          if (status.connected) {
            setDone(true);
            setDevice(null);
            onConnected();
          }
        })
        .catch(() => undefined);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [device, accountId, done, onConnected]);

  const pick = (id: ProviderId): void => {
    setProvider(id);
    setDevice(null);
    setAuthUrl(null);
    setError(null);
    const info = providers.find((entry) => entry.id === id);
    if (info) onProviderPicked(info);
  };

  const startDevice = async (): Promise<void> => {
    if (!accountId) return;
    setBusy(true);
    setError(null);
    try {
      const code = await api.oauthStartDevice(accountId, provider);
      setDevice({
        userCode: code.userCode,
        uri: code.verificationUri,
        complete: code.verificationUriComplete,
      });
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const startBrowser = async (): Promise<void> => {
    if (!accountId) return;
    setBusy(true);
    setError(null);
    try {
      const desktop = bridge();
      const port = desktop?.oauthLoopback ? await desktop.suggestPort?.() : undefined;
      const started = await api.oauthAuthorize(accountId, {
        provider,
        ...(port ? { mode: 'loopback' as const, loopbackPort: port } : {}),
      });
      setState(started.state);
      setAuthUrl(started.url);

      if (desktop?.oauthLoopback && port) {
        // The desktop app opens the browser and catches the redirect itself.
        const redirected = await desktop.oauthLoopback(started.url, port);
        await api.oauthComplete(redirected, started.state);
        setDone(true);
        onConnected();
        return;
      }

      window.open(started.url, '_blank', 'noreferrer');
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const finish = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api.oauthComplete(pasted, state ?? undefined);
      setDone(true);
      setPasted('');
      onConnected();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs" style={{ background: 'var(--ok-soft)', color: 'var(--ok)' }}>
        <Check size={15} />
        {t('oauth.connected')}
        <Button variant="ghost" className="ml-auto !py-1" onClick={() => setDone(false)}>
          <RefreshCw size={13} />
          {t('oauth.reconnect')}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl p-3" style={{ background: 'var(--surface-2)' }}>
      <div className="flex items-center gap-2">
        <KeyRound size={15} style={{ color: 'var(--accent)' }} />
        <span className="text-xs font-medium">{t('oauth.connectTitle')}</span>
      </div>

      <Field label={t('oauth.providerLabel')}>
        <Select value={provider} onChange={(event) => pick(event.target.value as ProviderId)}>
          {providers.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
              {entry.configured ? '' : ` — ${t('oauth.notConfigured')}`}
            </option>
          ))}
        </Select>
      </Field>

      {current && !current.configured && (
        <div className="text-xs" style={{ color: 'var(--warn)' }}>
          {t('oauth.configureFirst')}
        </div>
      )}

      {!accountId && (
        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {t('oauth.saveFirst')}
        </div>
      )}

      {error && (
        <div className="rounded-lg px-2.5 py-1.5 text-xs" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      {device ? (
        <div className="flex flex-col gap-2">
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {t('oauth.deviceHint')}
          </div>
          <div className="flex items-center gap-2">
            <code className="rounded-lg px-3 py-2 text-base tracking-widest" style={{ background: 'var(--surface-1)' }}>
              {device.userCode}
            </code>
            <Button onClick={() => void navigator.clipboard?.writeText(device.userCode)}>
              <Copy size={14} />
            </Button>
            <a
              href={device.complete ?? device.uri}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs"
              style={{ color: 'var(--accent)' }}
            >
              <ExternalLink size={14} />
              {device.uri}
            </a>
          </div>
          <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-faint)' }}>
            <Loader2 size={13} className="animate-spin" />
            {t('oauth.waiting')}
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {current?.deviceFlow && (
            <Button
              variant="primary"
              disabled={busy || !accountId || !current.configured}
              onClick={() => void startDevice()}
            >
              {t('oauth.startDevice')}
            </Button>
          )}
          <Button
            variant={current?.deviceFlow ? 'secondary' : 'primary'}
            disabled={busy || !accountId || !current?.configured}
            onClick={() => void startBrowser()}
          >
            <ExternalLink size={15} />
            {t('oauth.startBrowser')}
          </Button>
        </div>
      )}

      {authUrl && !bridge()?.oauthLoopback && (
        <div className="flex flex-col gap-2">
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {redirectMode === 'public' ? t('oauth.publicHint') : t('oauth.pasteHint')}
          </div>
          <a
            href={authUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 self-start text-xs"
            style={{ color: 'var(--accent)' }}
          >
            <ExternalLink size={14} />
            {t('oauth.openAgain')}
          </a>
          {redirectMode !== 'public' && (
            <div className="flex gap-2">
              <Input
                value={pasted}
                placeholder="http://127.0.0.1:49500/?code=…"
                onChange={(event) => setPasted(event.target.value)}
              />
              <Button variant="primary" disabled={busy || !pasted} onClick={() => void finish()}>
                {t('oauth.finish')}
              </Button>
            </div>
          )}
          {redirectMode === 'public' && (
            <Button disabled={busy} onClick={() => void (accountId && api.oauthDeviceStatus(accountId))}>
              <RefreshCw size={14} />
              {t('oauth.checkAgain')}
            </Button>
          )}
        </div>
      )}

      {isDesktop && (
        <div className="text-xs" style={{ color: 'var(--text-faint)' }}>
          {t('oauth.desktopHint')}
        </div>
      )}
    </div>
  );
}

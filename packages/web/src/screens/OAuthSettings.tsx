import type { OAuthClient, OperatorSettings } from '@amberchest/core';
import { KeyRound } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Field, Input, Select } from '../components/ui.js';

type OAuth = OperatorSettings['oauth'];
/** The same sections, but a provider may carry its secret on the way out. */
type OAuthPatch = Omit<OAuth, 'google' | 'microsoft' | 'custom'> & {
  google: Partial<OAuthClient> & OAuth['google'];
  microsoft: Partial<OAuthClient> & OAuth['microsoft'];
  custom: Partial<OAuthClient> & OAuth['custom'];
};
type ProviderId = 'google' | 'microsoft' | 'custom';

/**
 * The registered clients, one per provider.
 *
 * Neither Google nor Microsoft gives a mailbox scope to an unverified client,
 * so everybody registers their own and pastes it in here once.
 */
export function OAuthSettings({
  settings,
  callbackUrl,
  onChange,
}: {
  settings: OAuth;
  /** Full address of this instance's callback, for the public redirect. */
  callbackUrl: string;
  /** The client secret may be in here even though OAuth does not carry it. */
  onChange: (next: OAuthPatch) => void;
}): ReactNode {
  const { t } = useTranslation();
  const [provider, setProvider] = useState<ProviderId>('google');
  /** Typed here only; the stored secret never comes back from the server. */
  const [secret, setSecret] = useState('');

  const client = settings[provider];
  const patch = (part: Partial<OAuthClient>): void =>
    onChange({ ...settings, [provider]: { ...client, ...part } });

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center gap-2.5">
        <KeyRound size={16} style={{ color: 'var(--accent)' }} />
        <span className="text-sm font-medium">{t('oauth.title')}</span>
      </div>

      <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
        {t('oauth.intro')}
      </p>

      <div className="flex flex-wrap gap-1.5">
        {(['google', 'microsoft', 'custom'] as const).map((id) => {
          const active = id === provider;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setProvider(id)}
              className="rounded-full border px-3 py-1.5 text-xs transition"
              style={{
                background: active ? 'var(--accent-soft)' : 'var(--surface-1)',
                borderColor: active ? 'var(--accent)' : 'var(--border)',
                color: active ? 'var(--accent)' : 'var(--text-muted)',
              }}
            >
              {t(`oauth.provider.${id}`)}
              {settings[id].clientId ? ' ✓' : ''}
            </button>
          );
        })}
      </div>

      <Field label={t('oauth.clientId')} hint={t(`oauth.hint.${provider}`)}>
        <Input
          value={client.clientId}
          autoComplete="off"
          onChange={(event) => patch({ clientId: event.target.value })}
        />
      </Field>

      <Field
        label={t('oauth.clientSecret')}
        hint={client.hasClientSecret ? t('secret.stored') : t('oauth.clientSecretHint')}
      >
        <Input
          type="password"
          value={secret}
          placeholder={client.hasClientSecret ? t('secret.unchanged') : ''}
          autoComplete="new-password"
          onChange={(event) => setSecret(event.target.value)}
          onBlur={() => {
            if (secret === '') return;
            patch({ clientSecret: secret });
            setSecret('');
          }}
        />
      </Field>

      {provider === 'custom' && (
        <div className="flex flex-col gap-3">
          <Field label={t('oauth.authorizationEndpoint')}>
            <Input
              value={client.authorizationEndpoint}
              onChange={(event) => patch({ authorizationEndpoint: event.target.value })}
            />
          </Field>
          <Field label={t('oauth.tokenEndpoint')}>
            <Input
              value={client.tokenEndpoint}
              onChange={(event) => patch({ tokenEndpoint: event.target.value })}
            />
          </Field>
          <Field label={t('oauth.deviceEndpoint')} hint={t('oauth.deviceEndpointHint')}>
            <Input
              value={client.deviceEndpoint}
              onChange={(event) => patch({ deviceEndpoint: event.target.value })}
            />
          </Field>
          <Field label={t('oauth.scopes')} hint={t('oauth.scopesHint')}>
            <Input
              value={client.scopes.join(' ')}
              onChange={(event) =>
                patch({ scopes: event.target.value.split(/\s+/).filter(Boolean) })
              }
            />
          </Field>
        </div>
      )}

      <Field label={t('oauth.redirectMode')} hint={t('oauth.redirectModeHint')}>
        <Select
          value={settings.redirectMode}
          onChange={(event) =>
            onChange({ ...settings, redirectMode: event.target.value as OAuth['redirectMode'] })
          }
        >
          <option value="loopback">{t('oauth.redirectLoopback')}</option>
          <option value="public">{t('oauth.redirectPublic')}</option>
        </Select>
      </Field>

      {settings.redirectMode === 'public' && (
        <Field label={t('oauth.publicRedirectUri')} hint={t('oauth.publicRedirectUriHint')}>
          <div className="flex gap-2">
            <Input
              value={settings.publicRedirectUri}
              placeholder={callbackUrl}
              onChange={(event) => onChange({ ...settings, publicRedirectUri: event.target.value })}
            />
            <Button onClick={() => onChange({ ...settings, publicRedirectUri: callbackUrl })}>
              {t('oauth.useThisAddress')}
            </Button>
          </div>
        </Field>
      )}
    </Card>
  );
}

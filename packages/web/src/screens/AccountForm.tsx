import type { AccountOverview } from '@mail-archiver/core';
import { CheckCircle2, ChevronDown, PlugZap, XCircle } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { OAuthConnect } from './OAuthConnect.js';
import { api, type AccountFormValues, type AccountSettingsValues } from '../api/client.js';
import { Button, Field, Input, Modal, Select, Toggle } from '../components/ui.js';

const DEFAULT_SETTINGS: AccountSettingsValues = {
  concurrency: 2,
  batchSize: 200,
  requestDelayMs: 0,
  sinceDate: null,
  deletedHandling: 'move-to-deleted',
  deletedRetentionDays: null,
  autoSelectNewFolders: false,
};

const PORT_BY_SECURITY: Record<string, number> = { tls: 993, starttls: 143, none: 143 };

export function AccountForm({
  open,
  existing,
  onClose,
  onSaved,
}: {
  open: boolean;
  existing: AccountOverview | null;
  onClose: () => void;
  onSaved: () => void;
}): ReactNode {
  const { t } = useTranslation();
  const account = existing?.account;

  const [values, setValues] = useState<AccountFormValues>(() => ({
    name: account?.name ?? '',
    email: account?.email ?? '',
    host: account?.host ?? '',
    port: account?.port ?? 993,
    security: account?.security ?? 'tls',
    rejectUnauthorized: account?.rejectUnauthorized ?? true,
    username: account?.username ?? '',
    password: '',
    archivePath: account?.archivePath ?? null,
  }));
  const [settings, setSettings] = useState<AccountSettingsValues>({
    ...DEFAULT_SETTINGS,
    ...(account?.settings ?? {}),
  });
  const [authType, setAuthType] = useState<'password' | 'oauth'>(account?.authType ?? 'password');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const patch = (part: Partial<AccountFormValues>): void => setValues((current) => ({ ...current, ...part }));

  const onSecurityChange = (security: AccountFormValues['security']): void => {
    // Only follow the standard port while the user has not typed a custom one.
    const isStandardPort = Object.values(PORT_BY_SECURITY).includes(values.port);
    patch({ security, port: isStandardPort ? (PORT_BY_SECURITY[security] as number) : values.port });
  };

  const runTest = async (): Promise<void> => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await api.testConnection({
        host: values.host,
        port: values.port,
        security: values.security,
        rejectUnauthorized: values.rejectUnauthorized,
        username: values.username,
        password: values.password ?? '',
        ...(account ? { accountId: account.id } : {}),
      });
      setTestResult(
        result.ok
          ? { ok: true, message: t('account.testOk', { count: result.folderCount ?? 0 }) }
          : { ok: false, message: result.error ?? 'unknown' },
      );
    } catch (cause) {
      setTestResult({ ok: false, message: (cause as Error).message });
    } finally {
      setTesting(false);
    }
  };

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const payload: AccountFormValues = { ...values, settings, authType };
      if (!payload.password) delete payload.password;
      if (account) await api.updateAccount(account.id, payload);
      else await api.createAccount(payload);
      onSaved();
      onClose();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const canSave =
    values.name.trim() !== '' &&
    values.host.trim() !== '' &&
    values.username.trim() !== '' &&
    (account !== undefined || (values.password ?? '') !== '');

  return (
    <Modal
      open={open}
      wide
      title={account ? t('account.editTitle') : t('account.newTitle')}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('account.cancel')}
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={!canSave || busy}>
            {t('account.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t('account.name')}>
            <Input
              value={values.name}
              placeholder={t('account.namePlaceholder')}
              onChange={(event) => patch({ name: event.target.value })}
            />
          </Field>
          <Field label={t('account.email')}>
            <Input
              value={values.email}
              inputMode="email"
              onChange={(event) => {
                const email = event.target.value;
                // Pre-fill the user name from the address as long as it matches.
                patch(values.username === values.email ? { email, username: email } : { email });
              }}
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_auto]">
          <Field label={t('account.host')}>
            <Input value={values.host} onChange={(event) => patch({ host: event.target.value })} />
          </Field>
          <Field label={t('account.port')}>
            <Input
              type="number"
              className="sm:w-28"
              value={values.port}
              onChange={(event) => patch({ port: Number(event.target.value) })}
            />
          </Field>
        </div>

        <Field label={t('account.security')}>
          <Select
            value={values.security}
            onChange={(event) => onSecurityChange(event.target.value as AccountFormValues['security'])}
          >
            <option value="tls">{t('account.securityTls')}</option>
            <option value="starttls">{t('account.securityStarttls')}</option>
            <option value="none">{t('account.securityNone')}</option>
          </Select>
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t('account.username')}>
            <Input value={values.username} onChange={(event) => patch({ username: event.target.value })} />
          </Field>
          {authType === 'password' && (
            <Field label={t('account.password')} hint={account ? t('account.passwordKeep') : undefined}>
              <Input
                type="password"
                autoComplete="new-password"
                value={values.password ?? ''}
                onChange={(event) => patch({ password: event.target.value })}
              />
            </Field>
          )}
        </div>

        <Field label={t('account.authType')} hint={t('account.authTypeHint')}>
          <Select
            value={authType}
            onChange={(event) => setAuthType(event.target.value as 'password' | 'oauth')}
          >
            <option value="password">{t('account.authPassword')}</option>
            <option value="oauth">{t('account.authOauth')}</option>
          </Select>
        </Field>

        {authType === 'oauth' && (
          <OAuthConnect
            accountId={account?.id ?? null}
            connected={Boolean(account?.oauth?.connected)}
            onConnected={onSaved}
            onProviderPicked={(provider) => {
              // A fresh account gets the provider's server filled in.
              if (!account && !values.host) patch({ host: provider.imapHost, port: provider.imapPort });
            }}
          />
        )}

        <Toggle
          checked={values.rejectUnauthorized}
          onChange={(rejectUnauthorized) => patch({ rejectUnauthorized })}
          label={t('account.rejectUnauthorized')}
          hint={t('account.rejectUnauthorizedHint')}
        />

        <div className="flex items-center gap-3">
          <Button onClick={() => void runTest()} disabled={testing || !values.host || !values.username}>
            <PlugZap size={15} />
            {testing ? t('account.testing') : t('account.test')}
          </Button>
          {testResult && (
            <span
              className="flex items-center gap-1.5 text-xs"
              style={{ color: testResult.ok ? 'var(--ok)' : 'var(--danger)' }}
            >
              {testResult.ok ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
              {testResult.message}
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={() => setShowAdvanced((value) => !value)}
          className="flex items-center gap-1.5 self-start text-xs font-medium"
          style={{ color: 'var(--text-muted)' }}
        >
          <ChevronDown size={14} style={{ transform: showAdvanced ? 'rotate(180deg)' : 'none' }} />
          {t('account.advanced')}
        </button>

        {showAdvanced && (
          <div className="animate-fade-up flex flex-col gap-4 rounded-2xl border p-4" style={{ background: 'var(--surface-2)' }}>
            <Field label={t('account.archivePath')} hint={t('account.archivePathHint')}>
              <Input
                value={values.archivePath ?? ''}
                onChange={(event) => patch({ archivePath: event.target.value || null })}
              />
            </Field>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label={t('account.concurrency')}>
                <Input
                  type="number"
                  min={1}
                  max={8}
                  value={settings.concurrency}
                  onChange={(event) => setSettings({ ...settings, concurrency: Number(event.target.value) })}
                />
              </Field>
              <Field label={t('account.batchSize')}>
                <Input
                  type="number"
                  min={10}
                  max={2000}
                  value={settings.batchSize}
                  onChange={(event) => setSettings({ ...settings, batchSize: Number(event.target.value) })}
                />
              </Field>
              <Field label={t('account.requestDelay')}>
                <Input
                  type="number"
                  min={0}
                  max={10000}
                  value={settings.requestDelayMs}
                  onChange={(event) => setSettings({ ...settings, requestDelayMs: Number(event.target.value) })}
                />
              </Field>
            </div>

            <Field label={t('account.sinceDate')} hint={t('account.sinceDateHint')}>
              <Input
                type="date"
                value={settings.sinceDate ?? ''}
                onChange={(event) => setSettings({ ...settings, sinceDate: event.target.value || null })}
              />
            </Field>

            <Field label={t('account.deletedHandling')}>
              <Select
                value={settings.deletedHandling}
                onChange={(event) =>
                  setSettings({ ...settings, deletedHandling: event.target.value as AccountSettingsValues['deletedHandling'] })
                }
              >
                <option value="keep">{t('account.deletedKeep')}</option>
                <option value="move-to-deleted">{t('account.deletedMove')}</option>
                <option value="mirror">{t('account.deletedMirror')}</option>
              </Select>
            </Field>

            {settings.deletedHandling === 'move-to-deleted' && (
              <Field label={t('account.retention')} hint={t('account.retentionHint')}>
                <Input
                  type="number"
                  min={1}
                  max={3650}
                  value={settings.deletedRetentionDays ?? ''}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      deletedRetentionDays: event.target.value ? Number(event.target.value) : null,
                    })
                  }
                />
              </Field>
            )}

            <Toggle
              checked={settings.autoSelectNewFolders}
              onChange={(autoSelectNewFolders) => setSettings({ ...settings, autoSelectNewFolders })}
              label={t('account.autoSelectNew')}
            />
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

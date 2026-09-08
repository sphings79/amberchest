import {
  BookOpen,
  Check,
  Clock,
  Container,
  Database,
  DownloadCloud,
  ExternalLink,
  Lock,
  LockOpen,
  RotateCcw,
  ShieldAlert,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type AppSettings } from '../api/client.js';
import { Button, Card, Field, Input, ProgressBar, Select, Toggle } from '../components/ui.js';
import { DOCKER_DOCS_URL, REPO_URL } from '../constants.js';
import { NotificationSettings } from './NotificationSettings.js';
import { OAuthSettings } from './OAuthSettings.js';
import { UpdateCard } from './UpdateCard.js';
import { useApp } from '../state.js';

const EMPTY_OAUTH_CLIENT = {
  clientId: '',
  clientSecret: '',
  authorizationEndpoint: '',
  tokenEndpoint: '',
  deviceEndpoint: '',
  scopes: [],
  imapHost: '',
};

const ACCENTS = ['violet', 'blue', 'emerald', 'amber', 'rose'] as const;
const ACCENT_SWATCH: Record<string, string> = {
  violet: '#7c5cff',
  blue: '#3b82f6',
  emerald: '#10a37f',
  amber: '#e08b12',
  rose: '#e0457b',
};

export function Settings(): ReactNode {
  const { t } = useTranslation();
  const { server, accounts, indexProgress, migrationProgress, applySettings } = useApp();
  const [values, setValues] = useState<AppSettings>(
    server?.settings ?? {
      archivePath: '',
      language: 'de',
      theme: 'system',
      accentColor: 'violet',
      search: { indexAttachments: true, maxAttachmentBytes: 25 * 1024 * 1024, autoIndex: true },
      encryptArchive: false,
      mcp: {
        enabled: false,
        httpEnabled: false,
        token: '',
        permissions: {
          read: true,
          backup: false,
          export: false,
          accountsWrite: false,
          settingsWrite: false,
          delete: false,
        },
      },
      mqtt: {
        enabled: false,
        url: '',
        username: '',
        password: '',
        clientId: '',
        baseTopic: 'mailarchiver',
        discovery: true,
        discoveryPrefix: 'homeassistant',
        retain: true,
        allowCommands: true,
        publishIntervalSeconds: 60,
        rejectUnauthorized: true,
      },
      oauth: {
        google: EMPTY_OAUTH_CLIENT,
        microsoft: EMPTY_OAUTH_CLIENT,
        custom: EMPTY_OAUTH_CLIENT,
        redirectMode: 'loopback',
        publicRedirectUri: '',
      },
      storage: { warnBelowGb: 5, stopBelowGb: 1 },
      notifications: {
        enabled: false,
        url: '',
        format: 'json',
        authHeader: '',
        events: {
          backupFailed: true,
          backupFinished: false,
          verifyProblems: true,
          lowDiskSpace: true,
        },
      },
    },
  );
  const [space, setSpace] = useState<{ free: number; total: number } | null>(null);

  // The free space changes while a backup runs, so it is read on every visit.
  useEffect(() => {
    void api
      .storage()
      .then((value) => setSpace(value.space))
      .catch(() => undefined);
  }, []);
  const [saved, setSaved] = useState(false);
  const migrationRunning = migrationProgress
    ? !['done', 'failed', 'cancelled'].includes(migrationProgress.phase)
    : false;
  const [error, setError] = useState<string | null>(null);

  /** Appearance changes apply immediately; the path needs an explicit save. */
  const update = async (patch: Partial<AppSettings>, immediate: boolean): Promise<void> => {
    const next = { ...values, ...patch };
    setValues(next);
    if (!immediate) return;
    applySettings(next);
    try {
      applySettings(await api.updateSettings(patch));
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  const save = async (): Promise<void> => {
    setError(null);
    try {
      applySettings(await api.updateSettings(values));
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2200);
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <h1 className="text-xl font-semibold tracking-tight">{t('settings.title')}</h1>

      <Card className="flex flex-col gap-4">
        <Field label={t('settings.archivePath')} hint={t('settings.archivePathHint')}>
          <Input
            value={values.archivePath}
            onChange={(event) => void update({ archivePath: event.target.value }, false)}
          />
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t('settings.language')}>
            <Select
              value={values.language}
              onChange={(event) => void update({ language: event.target.value as AppSettings['language'] }, true)}
            >
              <option value="de">Deutsch</option>
              <option value="en">English</option>
            </Select>
          </Field>

          <Field label={t('settings.theme')}>
            <Select
              value={values.theme}
              onChange={(event) => void update({ theme: event.target.value as AppSettings['theme'] }, true)}
            >
              <option value="system">{t('settings.themeSystem')}</option>
              <option value="light">{t('settings.themeLight')}</option>
              <option value="dark">{t('settings.themeDark')}</option>
            </Select>
          </Field>
        </div>

        <Field label={t('settings.accent')}>
          <div className="flex gap-2">
            {ACCENTS.map((accent) => (
              <button
                key={accent}
                type="button"
                aria-label={accent}
                onClick={() => void update({ accentColor: accent }, true)}
                className="flex h-9 w-9 items-center justify-center rounded-xl border transition hover:scale-105"
                style={{
                  background: ACCENT_SWATCH[accent],
                  borderColor: values.accentColor === accent ? 'var(--text)' : 'transparent',
                  color: '#fff',
                }}
              >
                {values.accentColor === accent && <Check size={15} strokeWidth={3} />}
              </button>
            ))}
          </div>
        </Field>

        {error && (
          <div className="rounded-xl px-3 py-2 text-xs" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>
            {error}
          </div>
        )}

        <div className="flex items-center gap-3">
          <Button variant="primary" onClick={() => void save()}>
            {t('settings.save')}
          </Button>
          {saved && (
            <span className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--ok)' }}>
              <Check size={14} />
              {t('settings.saved')}
            </span>
          )}
        </div>
      </Card>

      <Card className="flex flex-col gap-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Database size={16} />
          {t('settings.searchTitle')}
        </div>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {t('settings.searchHint')}
        </p>

        <Toggle
          checked={values.search.indexAttachments}
          onChange={(indexAttachments) =>
            void update({ search: { ...values.search, indexAttachments } }, true)
          }
          label={t('settings.indexAttachments')}
          hint={t('settings.indexAttachmentsHint')}
        />

        <Field label={t('settings.maxAttachmentSize')} hint={t('settings.maxAttachmentSizeHint')}>
          <Input
            type="number"
            min={0}
            className="sm:max-w-40"
            value={Math.round(values.search.maxAttachmentBytes / (1024 * 1024))}
            onChange={(event) =>
              void update(
                { search: { ...values.search, maxAttachmentBytes: Number(event.target.value) * 1024 * 1024 } },
                false,
              )
            }
          />
        </Field>

        <Toggle
          checked={values.search.autoIndex}
          onChange={(autoIndex) => void update({ search: { ...values.search, autoIndex } }, true)}
          label={t('settings.autoIndex')}
        />

        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
            {t('settings.indexStatus', {
              done: accounts.reduce((sum, entry) => sum + entry.indexedCount, 0),
              total: accounts.reduce((sum, entry) => sum + entry.messageCount, 0),
            })}
          </span>
          <Button
            className="ml-auto"
            disabled={Object.values(indexProgress).some(
              (progress) => !['done', 'failed', 'cancelled'].includes(progress.phase),
            )}
            onClick={() => {
              if (!window.confirm(t('settings.rebuildConfirm'))) return;
              for (const entry of accounts) {
                void api.resetIndex(entry.account.id).then(() => api.startIndex(entry.account.id));
              }
            }}
          >
            <RotateCcw size={14} />
            {t('settings.rebuildIndex')}
          </Button>
        </div>
      </Card>

      <Card className="flex flex-col gap-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Lock size={16} />
          {t('settings.encryptTitle')}
        </div>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {t('settings.encryptHint')}
        </p>

        <Toggle
          checked={values.encryptArchive}
          onChange={(encryptArchive) => void update({ encryptArchive }, true)}
          label={t('settings.encryptToggle')}
        />

        {values.encryptArchive && (
          <div
            className="flex items-start gap-2 rounded-xl px-3 py-2 text-xs"
            style={{ background: 'var(--warn-soft)', color: 'var(--warn)' }}
          >
            <ShieldAlert size={14} className="mt-0.5 shrink-0" />
            {t('settings.encryptWarning')}
          </div>
        )}

        <div className="flex flex-col gap-2 rounded-2xl border p-4" style={{ background: 'var(--surface-2)' }}>
          <span className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
            {t('settings.migrateTitle')}
          </span>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {t('settings.migrateHint')}
          </p>
          <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
            {t('settings.migrateSafe')}
          </p>

          {migrationProgress && (
            <div className="flex flex-col gap-1.5 py-1">
              <ProgressBar
                value={
                  migrationProgress.stats.filesTotal > 0
                    ? migrationProgress.stats.filesDone / migrationProgress.stats.filesTotal
                    : 0
                }
                indeterminate={migrationRunning && migrationProgress.stats.filesTotal === 0}
              />
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {migrationRunning
                  ? t('settings.migrateRunning', {
                      done: migrationProgress.stats.filesDone,
                      total: migrationProgress.stats.filesTotal,
                    })
                  : t('settings.migrateDone', {
                      changed: migrationProgress.stats.filesChanged,
                      skipped: migrationProgress.stats.filesSkipped,
                    })}
              </span>
              {migrationProgress.stats.filesFailed > 0 && (
                <span className="text-xs" style={{ color: 'var(--danger)' }}>
                  {t('settings.migrateFailedFiles', { count: migrationProgress.stats.filesFailed })}
                </span>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {migrationRunning ? (
              <Button onClick={() => void api.cancelMigration()}>{t('settings.migrateCancel')}</Button>
            ) : (
              <>
                <Button
                  onClick={() => {
                    if (!window.confirm(t('settings.migrateConfirmEncrypt'))) return;
                    void api.startMigration('encrypt');
                  }}
                >
                  <Lock size={14} />
                  {t('settings.migrateEncrypt')}
                </Button>
                <Button
                  onClick={() => {
                    if (!window.confirm(t('settings.migrateConfirmDecrypt'))) return;
                    void api.startMigration('decrypt');
                  }}
                >
                  <LockOpen size={14} />
                  {t('settings.migrateDecrypt')}
                </Button>
              </>
            )}
          </div>
        </div>
      </Card>

      <NotificationSettings
        notifications={values.notifications}
        storage={values.storage}
        space={space}
        onChange={(part) => void update(part, true)}
      />

      <OAuthSettings
        settings={values.oauth}
        callbackUrl={`${window.location.origin}${window.location.pathname.replace(/\/$/, '')}/api/oauth/callback`}
        onChange={(oauth) => void update({ oauth }, true)}
      />

      <UpdateCard />

      <Card className="flex gap-3">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
          style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}
        >
          <Clock size={17} />
        </span>
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Container size={15} />
            {t('settings.scheduleTitle')}
          </div>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
            {t('settings.scheduleHint')}
          </p>
          <div className="mt-1 flex flex-wrap gap-2">
            {/* target=_blank makes the desktop shell open these in the real browser */}
            <a href={DOCKER_DOCS_URL} target="_blank" rel="noreferrer noopener">
              <Button variant="primary">
                <BookOpen size={15} />
                {t('settings.dockerLink')}
              </Button>
            </a>
            <a href={REPO_URL} target="_blank" rel="noreferrer noopener">
              <Button>
                <ExternalLink size={15} />
                {t('settings.repoLink')}
              </Button>
            </a>
          </div>
        </div>
      </Card>
    </div>
  );
}

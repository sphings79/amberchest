import type { AppSettings } from '@amberchest/core';
import { Bell, Check, HardDrive, Send, TriangleAlert } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client.js';
import { Button, Card, Field, Input, Select, Toggle } from '../components/ui.js';
import { formatBytes } from './Overview.js';

type Notifications = AppSettings['notifications'];
type Storage = AppSettings['storage'];
type EventKey = keyof Notifications['events'];

/**
 * Free space and where to shout when something goes wrong.
 *
 * The two belong together: running out of room is the failure most likely to
 * happen unattended, and the notification is how anybody finds out.
 */
export function NotificationSettings({
  notifications,
  storage,
  space,
  onChange,
}: {
  notifications: Notifications;
  storage: Storage;
  space: { free: number; total: number } | null;
  onChange: (part: Partial<AppSettings>) => void;
}): ReactNode {
  const { t } = useTranslation();
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; error?: string } | null>(null);

  const events: EventKey[] = ['backupFailed', 'backupFinished', 'verifyProblems', 'lowDiskSpace'];
  const low = space !== null && storage.warnBelowGb > 0 && space.free < storage.warnBelowGb * 1024 ** 3;

  const runTest = async (): Promise<void> => {
    setTesting(true);
    setResult(null);
    try {
      setResult(await api.testNotification());
    } catch (error) {
      setResult({ ok: false, error: (error as Error).message });
    } finally {
      setTesting(false);
    }
  };

  return (
    <>
      <Card className="flex flex-col gap-4">
        <div className="flex items-center gap-2.5">
          <HardDrive size={16} style={{ color: 'var(--accent)' }} />
          <span className="text-sm font-medium">{t('storage.title')}</span>
          {low && (
            <span
              className="flex items-center gap-1 rounded-full px-2 py-0.5 text-xs"
              style={{ background: 'var(--warn-soft)', color: 'var(--warn)' }}
            >
              <TriangleAlert size={12} />
              {t('storage.low')}
            </span>
          )}
        </div>

        {space ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline gap-2 text-sm">
              <span className="font-medium">{formatBytes(space.free)}</span>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {t('storage.freeOf', { total: formatBytes(space.total) })}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full" style={{ background: 'var(--surface-2)' }}>
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.min(100, ((space.total - space.free) / space.total) * 100)}%`,
                  background: low ? 'var(--warn)' : 'var(--accent)',
                }}
              />
            </div>
          </div>
        ) : (
          <div className="text-xs" style={{ color: 'var(--text-faint)' }}>
            {t('storage.unknown')}
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('storage.warnBelow')} hint={t('storage.warnBelowHint')}>
            <Input
              type="number"
              min={0}
              value={storage.warnBelowGb}
              onChange={(event) =>
                onChange({ storage: { ...storage, warnBelowGb: Number(event.target.value) } })
              }
            />
          </Field>
          <Field label={t('storage.stopBelow')} hint={t('storage.stopBelowHint')}>
            <Input
              type="number"
              min={0}
              value={storage.stopBelowGb}
              onChange={(event) =>
                onChange({ storage: { ...storage, stopBelowGb: Number(event.target.value) } })
              }
            />
          </Field>
        </div>
      </Card>

      <Card className="flex flex-col gap-4">
        <div className="flex items-center gap-2.5">
          <Bell size={16} style={{ color: 'var(--accent)' }} />
          <span className="text-sm font-medium">{t('notify.title')}</span>
        </div>

        <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          {t('notify.intro')}
        </p>

        <Toggle
          checked={notifications.enabled}
          onChange={(enabled) => onChange({ notifications: { ...notifications, enabled } })}
          label={t('notify.enable')}
        />

        {notifications.enabled && (
          <>
            <Field label={t('notify.url')} hint={t('notify.urlHint')}>
              <Input
                value={notifications.url}
                placeholder="https://ntfy.sh/mein-thema"
                onChange={(event) =>
                  onChange({ notifications: { ...notifications, url: event.target.value } })
                }
              />
            </Field>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={t('notify.format')}>
                <Select
                  value={notifications.format}
                  onChange={(event) =>
                    onChange({
                      notifications: {
                        ...notifications,
                        format: event.target.value as Notifications['format'],
                      },
                    })
                  }
                >
                  <option value="json">{t('notify.formatJson')}</option>
                  <option value="ntfy">ntfy</option>
                  <option value="gotify">Gotify</option>
                  <option value="discord">Discord</option>
                  <option value="apprise">Apprise</option>
                </Select>
              </Field>
              <Field label={t('notify.authHeader')} hint={t('notify.authHeaderHint')}>
                <Input
                  value={notifications.authHeader}
                  placeholder="Authorization: Bearer …"
                  onChange={(event) =>
                    onChange({
                      notifications: { ...notifications, authHeader: event.target.value },
                    })
                  }
                />
              </Field>
            </div>

            <div className="flex flex-col gap-2">
              {events.map((key) => (
                <Toggle
                  key={key}
                  checked={notifications.events[key]}
                  onChange={(value) =>
                    onChange({
                      notifications: {
                        ...notifications,
                        events: { ...notifications.events, [key]: value },
                      },
                    })
                  }
                  label={t(`notify.event.${key}`)}
                />
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button disabled={testing || !notifications.url} onClick={() => void runTest()}>
                <Send size={15} />
                {t('notify.test')}
              </Button>
              {result && (
                <span
                  className="flex items-center gap-1.5 text-xs"
                  style={{ color: result.ok ? 'var(--ok)' : 'var(--danger)' }}
                >
                  {result.ok ? <Check size={14} /> : <TriangleAlert size={14} />}
                  {result.ok ? t('notify.testOk') : result.error}
                </span>
              )}
            </div>
          </>
        )}
      </Card>
    </>
  );
}

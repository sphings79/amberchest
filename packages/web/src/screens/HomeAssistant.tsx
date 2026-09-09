import type { AppSettings, MqttStatus } from '@amberchest/core';
import {
  CircleCheck,
  CircleX,
  ExternalLink,
  Puzzle,
  RefreshCw,
  Send,
  Wifi,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client.js';
import { Badge, Button, Card, Field, Input, Select, Toggle } from '../components/ui.js';
import { HA_ADDON_URL, HA_INTEGRATION_URL } from '../constants.js';
import { useApp } from '../state.js';

type Mqtt = AppSettings['mqtt'];

/**
 * Everything that points at Home Assistant, in one place: the MQTT bridge and
 * the hint about the companion integration.
 */
export function HomeAssistant(): ReactNode {
  const { t } = useTranslation();
  const { server, applySettings, accounts } = useApp();
  const [status, setStatus] = useState<MqttStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const settings = server?.settings;

  // The connection state changes without the browser doing anything, so it is
  // polled while this screen is open.
  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const value = await api.mqttStatus();
        if (!cancelled) setStatus(value);
      } catch {
        // Keeps the previous status; the error is shown by the actions.
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  if (!settings) return null;
  const mqtt = settings.mqtt;

  const update = async (patch: Partial<Mqtt>): Promise<void> => {
    const next = { ...mqtt, ...patch };
    applySettings({ ...settings, mqtt: next });
    setError(null);
    try {
      applySettings(await api.updateSettings({ mqtt: next }));
      setStatus(await api.mqttStatus());
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  const run = async (action: () => Promise<MqttStatus>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      setStatus(await action());
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const connected = status?.connected ?? false;
  const topic = mqtt.baseTopic || 'amberchest';
  const sample = accounts[0]?.account.name ?? 'privat';
  const sampleSlug = sample
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <h1 className="text-xl font-semibold tracking-tight">{t('ha.title')}</h1>

      {error && (
        <div className="rounded-xl px-3 py-2 text-xs" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      <Card className="flex flex-col gap-4">
        <div className="flex items-center gap-2.5">
          <Wifi size={16} style={{ color: 'var(--accent)' }} />
          <span className="text-sm font-medium">{t('ha.mqttTitle')}</span>
          {mqtt.enabled && (
            <Badge tone={connected ? 'ok' : 'danger'}>
              {connected ? t('ha.connected') : t('ha.disconnected')}
            </Badge>
          )}
        </div>

        <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          {t('ha.mqttHint')}
        </p>

        <Toggle
          checked={mqtt.enabled}
          onChange={(enabled) => void update({ enabled })}
          label={t('ha.enable')}
        />

        {mqtt.enabled && (
          <>
            <Field label={t('ha.url')} hint={t('ha.urlHint')}>
              <Input
                value={mqtt.url}
                placeholder="mqtt://192.168.1.10:1883"
                onChange={(event) => void update({ url: event.target.value })}
              />
            </Field>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={t('ha.username')}>
                <Input
                  value={mqtt.username}
                  autoComplete="off"
                  onChange={(event) => void update({ username: event.target.value })}
                />
              </Field>
              <Field label={t('ha.password')}>
                <Input
                  type="password"
                  value={mqtt.password}
                  autoComplete="new-password"
                  onChange={(event) => void update({ password: event.target.value })}
                />
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={t('ha.baseTopic')} hint={t('ha.baseTopicHint')}>
                <Input
                  value={mqtt.baseTopic}
                  onChange={(event) => void update({ baseTopic: event.target.value })}
                />
              </Field>
              <Field label={t('ha.interval')}>
                <Select
                  value={String(mqtt.publishIntervalSeconds)}
                  onChange={(event) => void update({ publishIntervalSeconds: Number(event.target.value) })}
                >
                  <option value="30">30 s</option>
                  <option value="60">1 min</option>
                  <option value="300">5 min</option>
                  <option value="900">15 min</option>
                  <option value="3600">1 h</option>
                </Select>
              </Field>
            </div>

            <div className="rounded-xl p-3 text-xs" style={{ background: 'var(--surface-2)' }}>
              <div style={{ color: 'var(--text-faint)' }}>{t('ha.topics')}</div>
              <code className="mt-1 block" style={{ color: 'var(--text-muted)' }}>
                {topic}/status
                <br />
                {topic}/state
                <br />
                {topic}/account/{sampleSlug || 'konto'}/state
                <br />
                {topic}/account/{sampleSlug || 'konto'}/set
              </code>
            </div>

            <div className="flex flex-col gap-2">
              <Toggle
                checked={mqtt.discovery}
                onChange={(discovery) => void update({ discovery })}
                label={t('ha.discovery')}
              />
              <Toggle
                checked={mqtt.allowCommands}
                onChange={(allowCommands) => void update({ allowCommands })}
                label={t('ha.allowCommands')}
              />
              <Toggle
                checked={mqtt.retain}
                onChange={(retain) => void update({ retain })}
                label={t('ha.retain')}
              />
              <Toggle
                checked={!mqtt.rejectUnauthorized}
                onChange={(value) => void update({ rejectUnauthorized: !value })}
                label={t('ha.allowSelfSigned')}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button disabled={busy} onClick={() => void run(() => api.mqttReconnect())}>
                <RefreshCw size={15} />
                {t('ha.reconnect')}
              </Button>
              <Button disabled={busy || !connected} onClick={() => void run(() => api.mqttPublish())}>
                <Send size={15} />
                {t('ha.publishNow')}
              </Button>
              {status && (
                <span className="ml-auto flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-faint)' }}>
                  {connected ? (
                    <CircleCheck size={14} style={{ color: 'var(--ok)' }} />
                  ) : (
                    <CircleX size={14} style={{ color: 'var(--danger)' }} />
                  )}
                  {status.lastError
                    ? status.lastError
                    : status.lastPublishedAt
                      ? t('ha.lastPublished', {
                          time: new Date(status.lastPublishedAt).toLocaleTimeString(),
                        })
                      : t('ha.notPublished')}
                </span>
              )}
            </div>
          </>
        )}
      </Card>

      <Card className="flex flex-col gap-3">
        <div className="flex items-center gap-2.5">
          <Puzzle size={16} style={{ color: 'var(--accent)' }} />
          <span className="text-sm font-medium">{t('ha.integrationTitle')}</span>
        </div>
        <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          {t('ha.integrationHint')}
        </p>
        <a
          href={HA_INTEGRATION_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 self-start text-xs"
          style={{ color: 'var(--accent)' }}
        >
          <ExternalLink size={14} />
          {t('ha.integrationLink')}
        </a>

        <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          {t('ha.addonHint')}
        </p>
        <a
          href={HA_ADDON_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 self-start text-xs"
          style={{ color: 'var(--accent)' }}
        >
          <ExternalLink size={14} />
          {t('ha.addonLink')}
        </a>
      </Card>
    </div>
  );
}

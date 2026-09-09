import type { OperatorSettings } from '@amberchest/core';
import { Bot, Check, Copy, Eye, EyeOff, RefreshCw, ShieldAlert } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Button, Card, Field, Input, Toggle } from '../components/ui.js';

type Permission = keyof OperatorSettings['mcp']['permissions'];

/** Random token generated in the browser; it never has to leave this machine. */
function generateToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function McpSettings({
  settings,
  onChange,
}: {
  settings: OperatorSettings['mcp'];
  onChange: (next: OperatorSettings['mcp']) => void;
}): ReactNode {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  /** Off by default and never remembered; asking again is one click. */
  const [revealed, setRevealed] = useState(false);

  const permissions: Array<{ id: Permission; label: string; warning?: string }> = [
    { id: 'read', label: t('mcp.permRead') },
    { id: 'backup', label: t('mcp.permBackup') },
    { id: 'export', label: t('mcp.permExport') },
    { id: 'accountsWrite', label: t('mcp.permAccountsWrite') },
    { id: 'settingsWrite', label: t('mcp.permSettingsWrite') },
    { id: 'delete', label: t('mcp.permDelete'), warning: t('mcp.permDeleteWarning') },
  ];

  const enabledCount = permissions.filter((entry) => settings.permissions[entry.id]).length;

  const setPermission = (id: Permission, value: boolean): void =>
    onChange({ ...settings, permissions: { ...settings.permissions, [id]: value } });

  const copyToken = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(settings.token);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be denied; the field is selectable anyway.
    }
  };

  const configSnippet = JSON.stringify(
    {
      mcpServers: {
        'amberchest': {
          command: 'node',
          args: ['/pfad/zu/amberchest/packages/server/dist/mcp-stdio.js'],
          env: { AMBERCHEST_MASTER_PASSWORD: '••••••••' },
        },
      },
    },
    null,
    2,
  );

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Bot size={16} />
        {t('mcp.title')}
        {settings.enabled && <Badge tone="accent">{t('mcp.tools', { count: enabledCount })}</Badge>}
      </div>
      <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
        {t('mcp.hint')}
      </p>

      <Toggle
        checked={settings.enabled}
        onChange={(enabled) =>
          onChange({ ...settings, enabled, token: enabled && !settings.token ? generateToken() : settings.token })
        }
        label={t('mcp.enable')}
      />

      {settings.enabled && (
        <div className="animate-fade-up flex flex-col gap-4">
          <div className="flex flex-col gap-1 rounded-2xl border p-4" style={{ background: 'var(--surface-2)' }}>
            <span className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
              {t('mcp.permissions')}
            </span>

            {permissions.map((entry) => (
              <div key={entry.id} className="flex flex-col">
                <Toggle
                  checked={settings.permissions[entry.id]}
                  onChange={(value) => setPermission(entry.id, value)}
                  label={entry.label}
                />
                {entry.warning && settings.permissions[entry.id] && (
                  <div
                    className="ml-12 mb-1 flex items-start gap-1.5 rounded-lg px-2.5 py-1.5 text-xs"
                    style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}
                  >
                    <ShieldAlert size={13} className="mt-0.5 shrink-0" />
                    {entry.warning}
                  </div>
                )}
              </div>
            ))}

            <p className="mt-1 text-xs" style={{ color: 'var(--text-faint)' }}>
              {t('mcp.passwordNote')}
            </p>
          </div>

          <Toggle
            checked={settings.httpEnabled}
            onChange={(httpEnabled) => onChange({ ...settings, httpEnabled })}
            label={t('mcp.http')}
            hint={t('mcp.httpHint')}
          />

          {settings.httpEnabled && (
            <Field label={t('mcp.token')} hint={t('mcp.tokenHint')}>
              <div className="flex gap-2">
                {/*
                  Covered unless it is asked for: the token grants whatever
                  permissions are switched on, and a settings screen is open
                  for far longer than it takes to photograph it. Copying works
                  without ever showing it.
                */}
                <Input
                  readOnly
                  type={revealed ? 'text' : 'password'}
                  value={settings.token}
                  className="font-mono !text-xs"
                />
                <Button
                  onClick={() => setRevealed((value) => !value)}
                  aria-label={revealed ? t('mcp.hide') : t('mcp.reveal')}
                  title={revealed ? t('mcp.hide') : t('mcp.reveal')}
                >
                  {revealed ? <EyeOff size={15} /> : <Eye size={15} />}
                </Button>
                <Button onClick={() => void copyToken()} aria-label={t('mcp.copy')}>
                  {copied ? <Check size={15} /> : <Copy size={15} />}
                </Button>
                <Button
                  onClick={() => {
                    setRevealed(false);
                    onChange({ ...settings, token: generateToken() });
                  }}
                  aria-label={t('mcp.generate')}
                >
                  <RefreshCw size={15} />
                </Button>
              </div>
            </Field>
          )}

          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
              {t('mcp.setupTitle')}
            </span>
            <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
              {t('mcp.setupHint')}
            </p>
            <pre
              className="overflow-x-auto rounded-xl p-3 font-mono text-[11px] leading-relaxed"
              style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}
            >
              {configSnippet}
            </pre>
          </div>
        </div>
      )}
    </Card>
  );
}

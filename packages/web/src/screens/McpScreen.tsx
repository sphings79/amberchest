import type { AppSettings } from '@amberchest/core';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client.js';
import { useApp } from '../state.js';
import { McpSettings } from './McpSettings.js';

/** The AI connection has its own place in the navigation, not a card in settings. */
export function McpScreen(): ReactNode {
  const { t } = useTranslation();
  const { server, applySettings } = useApp();
  const [error, setError] = useState<string | null>(null);

  const settings = server?.settings;
  if (!settings) return null;

  const update = async (mcp: AppSettings['mcp']): Promise<void> => {
    applySettings({ ...settings, mcp });
    try {
      applySettings(await api.updateSettings({ mcp }));
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <h1 className="text-xl font-semibold tracking-tight">{t('mcp.title')}</h1>

      {error && (
        <div className="rounded-xl px-3 py-2 text-xs" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      <McpSettings settings={settings.mcp} onChange={(mcp) => void update(mcp)} />
    </div>
  );
}

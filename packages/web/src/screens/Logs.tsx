import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '../components/ui.js';
import { useApp } from '../state.js';

const LEVEL_COLOR: Record<string, string> = {
  debug: 'var(--text-faint)',
  info: 'var(--text-muted)',
  warn: 'var(--warn)',
  error: 'var(--danger)',
};

export function Logs(): ReactNode {
  const { t, i18n } = useTranslation();
  const { logs } = useApp();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [logs.length]);

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-xl font-semibold tracking-tight">{t('logs.title')}</h1>

      <Card className="!p-0">
        <div className="max-h-[70vh] overflow-y-auto p-3 font-mono text-xs leading-relaxed">
          {logs.length === 0 && (
            <div className="px-2 py-6 text-center" style={{ color: 'var(--text-faint)' }}>
              {t('logs.empty')}
            </div>
          )}
          {logs.map((entry, index) => (
            <div key={`${entry.ts}-${index}`} className="flex gap-3 px-2 py-0.5">
              <span className="shrink-0 tabular-nums" style={{ color: 'var(--text-faint)' }}>
                {new Date(entry.ts).toLocaleTimeString(i18n.language)}
              </span>
              <span className="w-12 shrink-0 uppercase" style={{ color: LEVEL_COLOR[entry.level] }}>
                {entry.level}
              </span>
              <span className="break-words" style={{ color: entry.level === 'error' ? 'var(--danger)' : 'var(--text)' }}>
                {entry.message}
              </span>
            </div>
          ))}
          <div ref={endRef} />
        </div>
      </Card>
    </div>
  );
}

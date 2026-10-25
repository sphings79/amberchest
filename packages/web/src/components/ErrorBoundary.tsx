import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from './ui.js';

function CrashNotice({ error }: { error: Error }): ReactNode {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div
        className="flex max-w-lg flex-col gap-3 rounded-xl p-5"
        style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
      >
        <div className="text-sm font-medium">{t('crash.title')}</div>
        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {t('crash.hint')}
        </div>
        <code
          className="break-words rounded-lg px-3 py-2 text-xs"
          style={{ background: 'var(--surface-1)', color: 'var(--danger)' }}
        >
          {error.message}
        </code>
        <Button variant="primary" className="self-start" onClick={() => window.location.reload()}>
          {t('crash.reload')}
        </Button>
      </div>
    </div>
  );
}

/** Shows the error instead of a white page when rendering throws. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Render failed:', error, info.componentStack);
  }

  override render(): ReactNode {
    return this.state.error ? <CrashNotice error={this.state.error} /> : this.props.children;
  }
}

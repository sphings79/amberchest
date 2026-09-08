import { DownloadCloud, ExternalLink } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Button, Card } from '../components/ui.js';
import { REPO_URL } from '../constants.js';

/** Version of this build, kept in step with the package version. */
const CURRENT_VERSION = '0.1.0';

const RELEASES_API = 'https://api.github.com/repos/sphings79/mail-archiver/releases/latest';

/**
 * Tells the user when a newer release exists.
 *
 * No automatic updates: without a signing certificate they would be more
 * dangerous than useful, so this only points at the download page.
 */
export function UpdateCard(): ReactNode {
  const { t } = useTranslation();
  const [state, setState] = useState<'idle' | 'checking' | 'latest' | 'available' | 'failed'>('idle');
  const [version, setVersion] = useState<string | null>(null);

  const check = async (): Promise<void> => {
    setState('checking');
    try {
      const response = await fetch(RELEASES_API, { headers: { accept: 'application/vnd.github+json' } });
      if (!response.ok) throw new Error(String(response.status));
      const release = (await response.json()) as { tag_name?: string };
      const tag = (release.tag_name ?? '').replace(/^v/, '');
      if (!tag) throw new Error('no tag');
      setVersion(tag);
      setState(tag === CURRENT_VERSION ? 'latest' : 'available');
    } catch {
      setState('failed');
    }
  };

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <DownloadCloud size={16} />
        {t('settings.updateTitle')}
        {state === 'available' && <Badge tone="accent">{version}</Badge>}
      </div>

      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        {t('settings.updateCurrent', { version: CURRENT_VERSION })}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => void check()} disabled={state === 'checking'}>
          {state === 'checking' ? t('settings.updateChecking') : t('settings.updateCheck')}
        </Button>

        {state === 'latest' && (
          <span className="text-xs" style={{ color: 'var(--ok)' }}>
            {t('settings.updateCurrentIsLatest')}
          </span>
        )}
        {state === 'failed' && (
          <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
            {t('settings.updateFailed')}
          </span>
        )}
        {state === 'available' && (
          <>
            <span className="text-xs" style={{ color: 'var(--accent)' }}>
              {t('settings.updateAvailable', { version })}
            </span>
            <a href={`${REPO_URL}/releases/latest`} target="_blank" rel="noreferrer noopener">
              <Button variant="primary">
                <ExternalLink size={15} />
                {t('settings.updateOpen')}
              </Button>
            </a>
          </>
        )}
      </div>
    </Card>
  );
}

import { TriangleAlert } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client.js';
import { Button, Card, Toggle } from '../components/ui.js';

/**
 * Confirms throwing away the local copy of a folder.
 *
 * Deliberately not a one click affair: the files are deleted, and unlike a
 * deletion on the server there is nothing left to restore from. It says how
 * many messages that is before asking, and offers the one thing that decides
 * whether the deletion lasts - taking the folder out of the selection, so the
 * next backup does not simply fetch it again.
 */
export function DiscardFolderDialog({
  accountId,
  path,
  messages,
  onClose,
  onDone,
}: {
  accountId: string;
  path: string;
  messages: number;
  onClose: () => void;
  onDone: (summary: string) => void;
}): ReactNode {
  const { t, i18n } = useTranslation();
  const [deselect, setDeselect] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.discardFolder(accountId, path, deselect);
      onDone(
        t('discard.done', {
          messages: result.messages.toLocaleString(i18n.language),
          handedOver: result.handedOver,
        }),
      );
    } catch (cause) {
      setError((cause as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <Card className="flex w-full max-w-md flex-col gap-4">
        <div className="flex items-center gap-2.5">
          <TriangleAlert size={16} style={{ color: 'var(--danger)' }} />
          <span className="text-sm font-medium">{t('discard.title')}</span>
        </div>

        <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          {t('discard.body', { path, count: messages.toLocaleString(i18n.language) })}
        </p>

        <Toggle
          checked={deselect}
          onChange={setDeselect}
          label={t('discard.deselect')}
          hint={t('discard.deselectHint')}
        />

        {error && (
          <div className="rounded-lg px-2.5 py-1.5 text-xs" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" onClick={() => void run()} disabled={busy}>
            {busy ? t('discard.running') : t('discard.confirm')}
          </Button>
        </div>
      </Card>
    </div>
  );
}

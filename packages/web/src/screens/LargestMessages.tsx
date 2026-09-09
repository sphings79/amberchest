import { Folder, Paperclip } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type LargestMessage } from '../api/client.js';
import { Button, Card, cx } from '../components/ui.js';
import { MessageView } from './MessageView.js';

const PAGE_SIZE = 50;

type Mode = 'size' | 'attachments';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

/**
 * What takes up the room, and where it is.
 *
 * Two lists that answer different questions: the largest messages, and the
 * ones carrying the largest attachments - a long thread is big with nothing
 * attached, one photograph makes a small message a large file. The folder is
 * part of every row, because "which one is that" is the first thing anybody
 * asks, and a row opens the message.
 */
export function LargestMessages({ accountId }: { accountId?: string }): ReactNode {
  const { t, i18n } = useTranslation();
  const [mode, setMode] = useState<Mode>('size');
  const [rows, setRows] = useState<LargestMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [open, setOpen] = useState<{ accountId: string; messageId: number } | null>(null);

  const load = useCallback(
    async (offset: number): Promise<void> => {
      setBusy(true);
      try {
        const result = await api.largestMessages({ accountId, by: mode, limit: PAGE_SIZE, offset });
        setRows((current) => (offset === 0 ? result.rows : [...current, ...result.rows]));
        setDone(result.rows.length < PAGE_SIZE);
      } finally {
        setBusy(false);
      }
    },
    [accountId, mode],
  );

  useEffect(() => {
    setRows([]);
    setDone(false);
    void load(0);
  }, [load]);

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{t('stats.largest')}</span>
        <div className="ml-auto flex rounded-xl p-0.5" style={{ background: 'var(--surface-2)' }}>
          {(['size', 'attachments'] as Mode[]).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value)}
              className={cx('rounded-lg px-2.5 py-1 text-xs transition')}
              style={
                mode === value
                  ? { background: 'var(--surface-1)', color: 'var(--text)' }
                  : { color: 'var(--text-muted)' }
              }
            >
              {value === 'size' ? t('stats.bySize') : t('stats.byAttachments')}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col">
        {rows.map((entry) => (
          <button
            key={`${entry.accountId}-${entry.id}`}
            type="button"
            onClick={() => setOpen({ accountId: entry.accountId, messageId: entry.id })}
            className="flex flex-col gap-0.5 border-t py-2 text-left text-xs transition first:border-t-0 hover:bg-[var(--surface-2)]"
            style={{ borderColor: 'var(--border)' }}
          >
            <div className="flex items-baseline gap-3">
              <span className="min-w-0 flex-1 truncate" style={{ color: 'var(--text)' }}>
                {entry.subject ?? t('stats.noSubject')}
              </span>
              <span className="shrink-0 tabular-nums" style={{ color: 'var(--text-muted)' }}>
                {formatBytes(mode === 'attachments' ? entry.attachmentBytes : entry.size)}
              </span>
            </div>
            <div className="flex items-baseline gap-2" style={{ color: 'var(--text-faint)' }}>
              <Folder size={11} className="shrink-0" />
              <span className="shrink-0 max-w-[45%] truncate" title={entry.folderPath}>
                {entry.folderPath}
              </span>
              <span className="min-w-0 flex-1 truncate">{entry.from ?? ''}</span>
              {entry.attachmentCount > 0 && (
                <span className="flex shrink-0 items-center gap-1">
                  <Paperclip size={10} />
                  {entry.attachmentCount}
                </span>
              )}
              <span className="shrink-0 tabular-nums">
                {new Date(entry.date).toLocaleDateString(i18n.language, {
                  year: '2-digit',
                  month: '2-digit',
                  day: '2-digit',
                })}
              </span>
            </div>
          </button>
        ))}
      </div>

      {rows.length === 0 && !busy && (
        <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
          {t('stats.noneWithAttachments')}
        </span>
      )}

      {!done && rows.length > 0 && (
        <Button variant="ghost" className="self-start" disabled={busy} onClick={() => void load(rows.length)}>
          {busy ? t('stats.loading') : t('stats.more')}
        </Button>
      )}

      {open && (
        <MessageView accountId={open.accountId} messageId={open.messageId} onClose={() => setOpen(null)} />
      )}
    </Card>
  );
}

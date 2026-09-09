import { RotateCcw, Search as SearchIcon, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type DiscardedMessage } from '../api/client.js';
import { Button, Card, EmptyState, Input, Select } from '../components/ui.js';
import { useApp } from '../state.js';

const PAGE_SIZE = 50;

/**
 * What was thrown out of the archive, and the way back.
 *
 * A message removed by hand leaves a tombstone so the next backup does not
 * fetch it again - which also means the decision has to be visible and
 * revocable, or a slip of the hand is final. Taking one back deletes its
 * tombstone; the mail is still on the server, so the next run brings it home.
 */
export function Discarded(): ReactNode {
  const { t, i18n } = useTranslation();
  const { accounts } = useApp();

  const [accountId, setAccountId] = useState('');
  const [folder, setFolder] = useState('');
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<DiscardedMessage[]>([]);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (offset: number): Promise<void> => {
      setBusy(true);
      setError(null);
      try {
        const result = await api.discarded({
          accountId: accountId || undefined,
          folder: folder || undefined,
          q: query || undefined,
          limit: PAGE_SIZE,
          offset,
        });
        setTotal(result.total);
        setRows((current) => (offset === 0 ? result.rows : [...current, ...result.rows]));
      } catch (cause) {
        setError((cause as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [accountId, folder, query],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => void load(0), 200);
    return () => window.clearTimeout(timer);
  }, [load]);

  const restore = async (row: DiscardedMessage): Promise<void> => {
    try {
      await api.undiscardMessage(row.account_id, row.id);
      await load(0);
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  const restoreAll = async (): Promise<void> => {
    if (!accountId) return;
    try {
      await api.undiscardAll(accountId, folder || undefined);
      await load(0);
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  // Only the folders that actually hold a tombstone are worth offering.
  const folders = [...new Set(rows.map((row) => row.folderPath))].sort();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight">{t('discarded.title')}</h1>
        <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
          {t('discarded.count', { count: total })}
        </span>
      </div>

      <Card className="flex flex-col gap-3">
        <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          {t('discarded.intro')}
        </p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Select value={accountId} onChange={(event) => setAccountId(event.target.value)}>
            <option value="">{t('discarded.allAccounts')}</option>
            {accounts.map((entry) => (
              <option key={entry.account.id} value={entry.account.id}>
                {entry.account.name}
              </option>
            ))}
          </Select>

          <Select value={folder} onChange={(event) => setFolder(event.target.value)}>
            <option value="">{t('discarded.allFolders')}</option>
            {folders.map((path) => (
              <option key={path} value={path}>
                {path}
              </option>
            ))}
          </Select>

          <div className="relative">
            <SearchIcon
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
              style={{ color: 'var(--text-faint)' }}
            />
            <Input
              value={query}
              placeholder={t('discarded.filter')}
              onChange={(event) => setQuery(event.target.value)}
              className="!pl-9"
            />
          </div>
        </div>

        {accountId && total > 0 && (
          <Button variant="ghost" className="self-start" onClick={() => void restoreAll()}>
            <RotateCcw size={14} />
            {folder ? t('discarded.restoreFolder') : t('discarded.restoreAccount')}
          </Button>
        )}

        {error && (
          <div
            className="rounded-lg px-2.5 py-1.5 text-xs"
            style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}
          >
            {error}
          </div>
        )}
      </Card>

      {rows.length === 0 && !busy ? (
        <EmptyState
          icon={<Trash2 size={22} />}
          title={t('discarded.emptyTitle')}
          description={t('discarded.emptyHint')}
        />
      ) : (
        <Card className="flex flex-col gap-0 !p-0">
          {rows.map((row) => (
            <div
              key={`${row.account_id}-${row.id}`}
              className="flex items-center gap-3 border-b px-4 py-2.5 last:border-b-0"
              style={{ borderColor: 'var(--border)' }}
            >
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-sm">{row.subject || t('stats.noSubject')}</span>
                <span className="truncate text-xs" style={{ color: 'var(--text-faint)' }}>
                  {row.folderPath} · {row.from_addr ?? '—'} ·{' '}
                  {new Date(row.internal_date).toLocaleDateString(i18n.language)}
                </span>
              </div>
              <Button onClick={() => void restore(row)} className="shrink-0 !py-1.5 !text-xs">
                <RotateCcw size={14} />
                {t('discarded.restore')}
              </Button>
            </div>
          ))}

          {rows.length < total && (
            <div className="p-3">
              <Button variant="ghost" disabled={busy} onClick={() => void load(rows.length)}>
                {busy ? t('stats.loading') : t('stats.more')}
              </Button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

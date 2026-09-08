import type { SearchHit, SearchResult } from '@mail-archiver/core';
import { Database, Paperclip, Search as SearchIcon, SlidersHorizontal, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client.js';
import { Badge, Button, Card, EmptyState, Field, Input, Select, Toggle, cx } from '../components/ui.js';
import { useApp } from '../state.js';
import { MessageView } from './MessageView.js';
import { formatBytes } from './Overview.js';

const PAGE_SIZE = 50;

interface Filters {
  accountId: string;
  from: string;
  dateFrom: string;
  dateTo: string;
  withAttachments: boolean;
  folders: string[];
}

const EMPTY_FILTERS: Filters = {
  accountId: '',
  from: '',
  dateFrom: '',
  dateTo: '',
  withAttachments: false,
  folders: [],
};

/** Renders the FTS snippet, which contains <mark> around the matched words. */
function Snippet({ html }: { html: string }): ReactNode {
  const parts = html.split(/(<mark>.*?<\/mark>)/g);
  return (
    <>
      {parts.map((part, index) => {
        const match = /^<mark>(.*)<\/mark>$/.exec(part);
        if (match) {
          return (
            <mark
              key={index}
              style={{ background: 'var(--accent-soft)', color: 'var(--accent)', padding: '0 2px', borderRadius: 3 }}
            >
              {match[1]}
            </mark>
          );
        }
        return <span key={index}>{part}</span>;
      })}
    </>
  );
}

export function Search(): ReactNode {
  const { t, i18n } = useTranslation();
  const { accounts, indexProgress } = useApp();

  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<{ accountId: string; messageId: number } | null>(null);
  const debounce = useRef<number | undefined>(undefined);

  const run = useCallback(
    async (nextOffset: number): Promise<void> => {
      setBusy(true);
      setError(null);
      try {
        const value = await api.search({
          q: query,
          account: filters.accountId || undefined,
          folders: filters.folders,
          from: filters.from || undefined,
          dateFrom: filters.dateFrom || undefined,
          dateTo: filters.dateTo || undefined,
          withAttachments: filters.withAttachments,
          limit: PAGE_SIZE,
          offset: nextOffset,
        });
        setResult(value);
        setHits((current) => (nextOffset === 0 ? value.hits : [...current, ...value.hits]));
        setOffset(nextOffset);
      } catch (cause) {
        setError((cause as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [query, filters],
  );

  // Debounced search while typing; filters apply immediately.
  useEffect(() => {
    window.clearTimeout(debounce.current);
    debounce.current = window.setTimeout(() => void run(0), 250);
    return () => window.clearTimeout(debounce.current);
  }, [run]);

  const indexed = accounts.reduce((sum, entry) => sum + entry.indexedCount, 0);
  const messages = accounts.reduce((sum, entry) => sum + entry.messageCount, 0);
  const needsIndex = messages > 0 && indexed < messages;
  const runningIndex = Object.values(indexProgress).find(
    (progress) => !['done', 'failed', 'cancelled'].includes(progress.phase),
  );

  const folderOptions = accounts
    .filter((entry) => !filters.accountId || entry.account.id === filters.accountId)
    .flatMap((entry) => entry.account.selectedFolders);

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-xl font-semibold tracking-tight">{t('search.title')}</h1>

      <Card className="flex flex-col gap-3 !p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[240px] flex-1">
            <SearchIcon
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
              style={{ color: 'var(--text-faint)' }}
            />
            <Input
              autoFocus
              value={query}
              placeholder={t('search.placeholder')}
              onChange={(event) => setQuery(event.target.value)}
              className="!pl-9"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2"
                style={{ color: 'var(--text-faint)' }}
              >
                <X size={14} />
              </button>
            )}
          </div>

          <Select
            className="!w-auto"
            value={filters.accountId}
            onChange={(event) => setFilters({ ...filters, accountId: event.target.value, folders: [] })}
          >
            <option value="">{t('search.allAccounts')}</option>
            {accounts.map((entry) => (
              <option key={entry.account.id} value={entry.account.id}>
                {entry.account.name}
              </option>
            ))}
          </Select>

          <Button onClick={() => setShowFilters((value) => !value)}>
            <SlidersHorizontal size={15} />
            {t('search.filters')}
          </Button>
        </div>

        {showFilters && (
          <div className="animate-fade-up flex flex-col gap-3 rounded-xl p-3" style={{ background: 'var(--surface-2)' }}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label={t('search.from')}>
                <Input value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} />
              </Field>
              <Field label={t('search.dateFrom')}>
                <Input
                  type="date"
                  value={filters.dateFrom}
                  onChange={(event) => setFilters({ ...filters, dateFrom: event.target.value })}
                />
              </Field>
              <Field label={t('search.dateTo')}>
                <Input
                  type="date"
                  value={filters.dateTo}
                  onChange={(event) => setFilters({ ...filters, dateTo: event.target.value })}
                />
              </Field>
            </div>

            <Toggle
              checked={filters.withAttachments}
              onChange={(withAttachments) => setFilters({ ...filters, withAttachments })}
              label={t('search.withAttachments')}
            />

            {folderOptions.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {folderOptions.map((path) => {
                  const active = filters.folders.includes(path);
                  return (
                    <button
                      key={path}
                      type="button"
                      onClick={() =>
                        setFilters({
                          ...filters,
                          folders: active
                            ? filters.folders.filter((value) => value !== path)
                            : [...filters.folders, path],
                        })
                      }
                      className="rounded-full border px-2.5 py-1 text-xs transition"
                      style={{
                        background: active ? 'var(--accent-soft)' : 'var(--surface-1)',
                        borderColor: active ? 'var(--accent)' : 'var(--border)',
                        color: active ? 'var(--accent)' : 'var(--text-muted)',
                      }}
                    >
                      {path}
                    </button>
                  );
                })}
              </div>
            )}

            <Button variant="ghost" className="self-start" onClick={() => setFilters(EMPTY_FILTERS)}>
              {t('search.reset')}
            </Button>
          </div>
        )}
      </Card>

      {needsIndex && (
        <Card className="flex flex-wrap items-center gap-3 !p-4">
          <Database size={16} style={{ color: 'var(--accent)' }} />
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {runningIndex
              ? t('search.indexed', {
                  done: runningIndex.stats.messagesDone,
                  total: runningIndex.stats.messagesTotal,
                })
              : t('search.indexed', { done: indexed, total: messages })}
          </span>
          {!runningIndex && (
            <Button
              variant="primary"
              className="ml-auto"
              onClick={() => {
                for (const entry of accounts) {
                  if (entry.indexedCount < entry.messageCount) void api.startIndex(entry.account.id);
                }
              }}
            >
              {t('search.buildIndex')}
            </Button>
          )}
        </Card>
      )}

      {error && (
        <div className="rounded-xl px-3 py-2 text-xs" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      {result && (
        <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-faint)' }}>
          {t('search.results', { count: result.total })}
        </div>
      )}

      {hits.length === 0 && !busy ? (
        <EmptyState
          icon={<SearchIcon size={22} />}
          title={query ? t('search.noResults') : t('search.empty')}
          description={query ? t('search.noResultsHint') : ''}
        />
      ) : (
        <div className="flex flex-col gap-2">
          {hits.map((hit) => (
            <button
              key={`${hit.accountId}-${hit.messageId}`}
              type="button"
              onClick={() => setOpen({ accountId: hit.accountId, messageId: hit.messageId })}
              className={cx('rounded-xl border p-3 text-left transition hover:brightness-110')}
              style={{ background: 'var(--surface-1)' }}
            >
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-medium">{hit.subject || '—'}</span>
                {hit.attachmentCount > 0 && (
                  <Badge tone="accent">
                    <Paperclip size={10} />
                    {hit.attachmentCount}
                  </Badge>
                )}
                {!hit.flags.includes('\\Seen') && <Badge tone="ok">•</Badge>}
                <span className="ml-auto text-xs tabular-nums" style={{ color: 'var(--text-faint)' }}>
                  {new Date(hit.internalDate).toLocaleDateString(i18n.language, {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                  })}
                </span>
              </div>
              <div className="mt-0.5 flex flex-wrap gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                <span className="truncate">{hit.fromAddr ?? '—'}</span>
                <span style={{ color: 'var(--text-faint)' }}>{hit.folderPath}</span>
                <span className="ml-auto" style={{ color: 'var(--text-faint)' }}>
                  {formatBytes(hit.size)}
                </span>
              </div>
              {hit.snippet && (
                <div className="mt-1.5 text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                  <Snippet html={hit.snippet} />
                </div>
              )}
            </button>
          ))}

          {result && hits.length < result.total && (
            <Button className="self-center" disabled={busy} onClick={() => void run(offset + PAGE_SIZE)}>
              {t('search.loadMore')}
            </Button>
          )}
        </div>
      )}

      {open && (
        <MessageView accountId={open.accountId} messageId={open.messageId} onClose={() => setOpen(null)} />
      )}
    </div>
  );
}

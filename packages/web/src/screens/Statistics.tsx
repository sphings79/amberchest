import { BarChart3, Link2, Mail, Paperclip, Trash2 } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { LargestMessages } from './LargestMessages.js';
import { api, type Statistics } from '../api/client.js';
import { Card, EmptyState, Select } from '../components/ui.js';
import { useApp } from '../state.js';
import { formatBytes } from './Overview.js';

/** A row with a bar behind it, which is all a chart needs to be here. */
function Bar({
  label,
  value,
  max,
  note,
}: {
  label: string;
  value: number;
  max: number;
  note?: string;
}): ReactNode {
  const width = max > 0 ? Math.max(2, (value / max) * 100) : 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline gap-2 text-xs">
        <span className="truncate" style={{ color: 'var(--text)' }}>
          {label}
        </span>
        <span className="ml-auto shrink-0 tabular-nums" style={{ color: 'var(--text-muted)' }}>
          {value.toLocaleString()}
        </span>
        {note && (
          <span className="shrink-0 tabular-nums" style={{ color: 'var(--text-faint)' }}>
            {note}
          </span>
        )}
      </div>
      <div className="h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--surface-2)' }}>
        <div className="h-full rounded-full" style={{ width: `${width}%`, background: 'var(--accent)' }} />
      </div>
    </div>
  );
}

function Tile({ icon, label, value, note }: { icon: ReactNode; label: string; value: string; note?: string }): ReactNode {
  return (
    <Card className="flex items-center gap-3 !p-4">
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
        style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>
          {label}
        </div>
        <div className="text-lg font-semibold">{value}</div>
        {note && (
          <div className="text-xs" style={{ color: 'var(--text-faint)' }}>
            {note}
          </div>
        )}
      </div>
    </Card>
  );
}

/**
 * What is actually in the archive.
 *
 * Everything here comes out of the index, so the page costs nothing but a few
 * queries - no file is read and no server is asked.
 */
export function Statistics(): ReactNode {
  const { t, i18n } = useTranslation();
  const { accounts } = useApp();
  const [accountId, setAccountId] = useState('');
  const [data, setData] = useState<Statistics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    void api
      .statistics(accountId || undefined)
      .then(setData)
      .catch((cause: Error) => setError(cause.message));
  }, [accountId]);

  const date = (value: string | null): string =>
    value ? new Date(value).toLocaleDateString(i18n.language, { dateStyle: 'medium' }) : '–';

  const maxYear = Math.max(1, ...(data?.perYear ?? []).map((entry) => entry.messages));
  const maxFolder = Math.max(1, ...(data?.perFolder ?? []).map((entry) => entry.messages));
  const maxSender = Math.max(1, ...(data?.topSenders ?? []).map((entry) => entry.messages));
  const maxType = Math.max(1, ...(data?.attachments.byType ?? []).map((entry) => entry.bytes));

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">{t('stats.title')}</h1>
        <Select
          className="!w-auto"
          value={accountId}
          onChange={(event) => setAccountId(event.target.value)}
        >
          <option value="">{t('stats.allAccounts')}</option>
          {accounts.map((entry) => (
            <option key={entry.account.id} value={entry.account.id}>
              {entry.account.name}
            </option>
          ))}
        </Select>
      </div>

      {error && (
        <div className="rounded-xl px-3 py-2 text-xs" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      {data && data.totals.messages === 0 ? (
        <EmptyState icon={<BarChart3 size={22} />} title={t('stats.empty')} description={t('stats.emptyHint')} />
      ) : (
        data && (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Tile
                icon={<Mail size={16} />}
                label={t('stats.messages')}
                value={data.totals.messages.toLocaleString()}
                note={t('stats.range', { first: date(data.range.first), last: date(data.range.last) })}
              />
              <Tile
                icon={<BarChart3 size={16} />}
                label={t('stats.size')}
                value={formatBytes(data.totals.bytes)}
                note={t('stats.average', {
                  size: formatBytes(
                    data.totals.messages > 0 ? Math.round(data.totals.bytes / data.totals.messages) : 0,
                  ),
                })}
              />
              <Tile
                icon={<Paperclip size={16} />}
                label={t('stats.attachments')}
                value={data.attachments.files.toLocaleString()}
                note={formatBytes(data.attachments.bytes)}
              />
              <Tile
                icon={data.totals.linked > 0 ? <Link2 size={16} /> : <Trash2 size={16} />}
                label={data.totals.linked > 0 ? t('stats.linked') : t('stats.deleted')}
                value={(data.totals.linked > 0 ? data.totals.linked : data.totals.deleted).toLocaleString()}
                note={data.totals.linked > 0 ? t('stats.linkedHint') : t('stats.deletedHint')}
              />
            </div>

            <Card className="flex flex-col gap-3">
              <span className="text-sm font-medium">{t('stats.perYear')}</span>
              <div className="flex flex-col gap-2.5">
                {data.perYear.map((entry) => (
                  <Bar
                    key={entry.year}
                    label={entry.year}
                    value={entry.messages}
                    max={maxYear}
                    note={formatBytes(entry.bytes)}
                  />
                ))}
              </div>
            </Card>

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <Card className="flex flex-col gap-3">
                <span className="text-sm font-medium">{t('stats.topSenders')}</span>
                <div className="flex flex-col gap-2.5">
                  {data.topSenders.map((entry) => (
                    <Bar
                      key={entry.address}
                      label={entry.address}
                      value={entry.messages}
                      max={maxSender}
                      note={formatBytes(entry.bytes)}
                    />
                  ))}
                </div>
              </Card>

              <Card className="flex flex-col gap-3">
                <span className="text-sm font-medium">{t('stats.perFolder')}</span>
                <div className="flex flex-col gap-2.5">
                  {data.perFolder.map((entry) => (
                    <Bar
                      key={entry.path}
                      label={entry.path}
                      value={entry.messages}
                      max={maxFolder}
                      note={formatBytes(entry.bytes)}
                    />
                  ))}
                </div>
              </Card>
            </div>

            {data.attachments.byType.length > 0 && (
              <Card className="flex flex-col gap-3">
                <span className="text-sm font-medium">{t('stats.attachmentTypes')}</span>
                <div className="flex flex-col gap-2.5">
                  {data.attachments.byType.map((entry) => (
                    <Bar
                      key={entry.type}
                      label={entry.type}
                      value={entry.bytes}
                      max={maxType}
                      note={t('stats.files', { count: entry.files })}
                    />
                  ))}
                </div>
              </Card>
            )}

            <LargestMessages accountId={accountId || undefined} />
          </>
        )
      )}
    </div>
  );
}

import type { AccountOverview, SyncProgress } from '@mail-archiver/core';
import {
  Activity,
  CheckCircle2,
  Database,
  FolderTree,
  HardDrive,
  Mail,
  PlayCircle,
  Users,
  XCircle,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client.js';
import { Badge, Button, Card, EmptyState, ProgressBar } from '../components/ui.js';
import { useApp } from '../state.js';

interface RunRow {
  id: string;
  account_id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  stats: string;
  error: string | null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

function StatTile({
  icon,
  label,
  value,
  hint,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  hint?: string;
}): ReactNode {
  return (
    <Card className="flex items-start gap-3 !p-4">
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
        style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>
          {label}
        </div>
        <div className="truncate text-lg font-semibold tabular-nums">{value}</div>
        {hint && (
          <div className="truncate text-xs" style={{ color: 'var(--text-faint)' }}>
            {hint}
          </div>
        )}
      </div>
    </Card>
  );
}

function AccountRow({
  overview,
  progress,
}: {
  overview: AccountOverview;
  progress: SyncProgress | undefined;
}): ReactNode {
  const { t, i18n } = useTranslation();
  const running = overview.running || (progress ? !['done', 'failed', 'cancelled'].includes(progress.phase) : false);
  const lastRun = overview.lastRun as { started_at?: string; status?: string } | null;
  const ratio =
    progress && progress.folderMessagesTotal > 0
      ? progress.folderMessagesDone / progress.folderMessagesTotal
      : 0;

  return (
    <div className="flex flex-col gap-2 rounded-xl px-3 py-2.5" style={{ background: 'var(--surface-2)' }}>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[11px] font-semibold"
          style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
        >
          {overview.account.name.slice(0, 2).toUpperCase()}
        </span>
        <span className="truncate text-sm font-medium">{overview.account.name}</span>
        {running ? (
          <Badge tone="accent">{t(`progress.${progress?.phase ?? 'connecting'}`)}</Badge>
        ) : lastRun?.status === 'failed' ? (
          <Badge tone="danger">{t('progress.failed')}</Badge>
        ) : (
          <Badge tone="ok">{t('dashboard.idle')}</Badge>
        )}
        <span className="ml-auto text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
          {overview.messageCount.toLocaleString(i18n.language)} · {formatBytes(overview.bytes)}
        </span>
      </div>
      {running && <ProgressBar value={ratio} indeterminate={ratio === 0 || progress?.phase !== 'downloading'} />}
    </div>
  );
}

export function Overview({ onGoToAccounts }: { onGoToAccounts: () => void }): ReactNode {
  const { t, i18n } = useTranslation();
  const { accounts, progress } = useApp();
  const [runs, setRuns] = useState<RunRow[]>([]);

  const runningCount = accounts.filter(
    (entry) =>
      entry.running ||
      (progress[entry.account.id]
        ? !['done', 'failed', 'cancelled'].includes(progress[entry.account.id]?.phase ?? '')
        : false),
  ).length;

  useEffect(() => {
    void api
      .recentRuns(8)
      .then((rows) => setRuns(rows as unknown as RunRow[]))
      .catch(() => undefined);
  }, [accounts, progress]);

  const totals = accounts.reduce(
    (sum, entry) => ({
      messages: sum.messages + entry.messageCount,
      folders: sum.folders + entry.account.selectedFolders.length,
      bytes: sum.bytes + entry.bytes,
      deleted: sum.deleted + entry.deletedCount,
    }),
    { messages: 0, folders: 0, bytes: 0, deleted: 0 },
  );

  const nameOf = (accountId: string): string =>
    accounts.find((entry) => entry.account.id === accountId)?.account.name ?? '—';

  const backupAll = (): void => {
    for (const entry of accounts) {
      // Accounts without a folder selection are skipped; their own card links
      // to the picker.
      if (entry.running || entry.account.selectedFolders.length === 0) continue;
      void api.startSync(entry.account.id);
    }
  };

  if (accounts.length === 0) {
    return (
      <div className="flex flex-col gap-5">
        <h1 className="text-xl font-semibold tracking-tight">{t('overview.title')}</h1>
        <EmptyState
          icon={<Mail size={22} />}
          title={t('dashboard.empty')}
          description={t('dashboard.emptyHint')}
          action={
            <Button variant="primary" onClick={onGoToAccounts}>
              {t('nav.addAccount')}
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">{t('overview.title')}</h1>
        <Button
          variant="primary"
          onClick={backupAll}
          disabled={accounts.every((entry) => entry.running || entry.account.selectedFolders.length === 0)}
        >
          <PlayCircle size={16} />
          {t('overview.backupAll')}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          icon={<Users size={17} />}
          label={t('overview.accounts')}
          value={String(accounts.length)}
          hint={runningCount > 0 ? t('overview.runningNow', { count: runningCount }) : undefined}
        />
        <StatTile
          icon={<Mail size={17} />}
          label={t('overview.messages')}
          value={totals.messages.toLocaleString(i18n.language)}
          hint={totals.deleted > 0 ? t('overview.inDeleted', { count: totals.deleted }) : undefined}
        />
        <StatTile
          icon={<FolderTree size={17} />}
          label={t('overview.folders')}
          value={String(totals.folders)}
        />
        <StatTile
          icon={<HardDrive size={17} />}
          label={t('overview.size')}
          value={formatBytes(totals.bytes)}
          hint={t('overview.sizeHint')}
        />
      </div>

      <Card className="flex flex-col gap-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Activity size={16} />
          {t('overview.status')}
        </div>
        <div className="flex flex-col gap-2">
          {accounts.map((entry) => (
            <AccountRow key={entry.account.id} overview={entry} progress={progress[entry.account.id]} />
          ))}
        </div>
        <Button className="self-start" onClick={onGoToAccounts}>
          {t('overview.manageAccounts')}
        </Button>
      </Card>

      <Card className="flex flex-col gap-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Database size={16} />
          {t('overview.recentRuns')}
        </div>
        {runs.length === 0 ? (
          <div className="py-3 text-xs" style={{ color: 'var(--text-faint)' }}>
            {t('overview.noRuns')}
          </div>
        ) : (
          <div className="flex flex-col">
            {runs.map((run) => {
              const stats = JSON.parse(run.stats || '{}') as {
                messagesNew?: number;
                messagesMoved?: number;
                messagesDeleted?: number;
              };
              const failed = run.status === 'failed';
              return (
                <div
                  key={run.id}
                  className="flex flex-wrap items-center gap-2 border-b py-2 last:border-b-0"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <span style={{ color: failed ? 'var(--danger)' : 'var(--ok)' }}>
                    {failed ? <XCircle size={14} /> : <CheckCircle2 size={14} />}
                  </span>
                  <span className="text-sm">{nameOf(run.account_id)}</span>
                  <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
                    {new Date(run.started_at).toLocaleString(i18n.language, {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                  </span>
                  <span className="ml-auto text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
                    {stats.messagesNew ?? 0} {t('progress.new')} · {stats.messagesMoved ?? 0}{' '}
                    {t('progress.moved')} · {stats.messagesDeleted ?? 0} {t('progress.deleted')}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

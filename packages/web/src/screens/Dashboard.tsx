import type { AccountOverview, SyncProgress } from '@mail-archiver/core';
import {
  CalendarClock,
  FolderTree,
  Mail,
  Pencil,
  Play,
  Plus,
  Server,
  Square,
  Trash2,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client.js';
import { Badge, Button, Card, EmptyState, ProgressBar } from '../components/ui.js';
import { useApp } from '../state.js';
import { AccountForm } from './AccountForm.js';
import { FolderPicker } from './FolderPicker.js';

function formatBytes(bytes: number): string {
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

function formatDate(iso: string | null | undefined, locale: string, never: string): string {
  if (!iso) return never;
  return new Date(iso).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
}

function ProgressSection({ progress }: { progress: SyncProgress }): ReactNode {
  const { t, i18n } = useTranslation();
  const active = !['done', 'failed', 'cancelled'].includes(progress.phase);
  const ratio =
    progress.folderMessagesTotal > 0 ? progress.folderMessagesDone / progress.folderMessagesTotal : 0;

  return (
    <div className="animate-fade-up mt-4 flex flex-col gap-2.5 rounded-xl p-3.5" style={{ background: 'var(--surface-2)' }}>
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium">{t(`progress.${progress.phase}`)}</span>
        {progress.currentFolder && active && (
          <span className="truncate text-xs" style={{ color: 'var(--text-faint)' }}>
            {progress.currentFolder}
          </span>
        )}
        <span className="ml-auto text-xs tabular-nums" style={{ color: 'var(--text-faint)' }}>
          {progress.folderMessagesTotal > 0 && active
            ? `${progress.folderMessagesDone} / ${progress.folderMessagesTotal}`
            : ''}
        </span>
      </div>

      <ProgressBar
        value={ratio}
        indeterminate={active && (progress.folderMessagesTotal === 0 || progress.phase !== 'downloading')}
      />

      <div className="flex flex-wrap items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
        <span>
          <strong className="tabular-nums">{progress.stats.messagesNew}</strong> {t('progress.new')}
        </span>
        <span>
          <strong className="tabular-nums">{progress.stats.messagesMoved}</strong> {t('progress.moved')}
        </span>
        <span>
          <strong className="tabular-nums">{progress.stats.messagesDeleted}</strong> {t('progress.deleted')}
        </span>
        <span>
          <strong className="tabular-nums">{formatBytes(progress.stats.bytesDownloaded)}</strong>{' '}
          {t('progress.downloaded')}
        </span>
        <span className="ml-auto" style={{ color: 'var(--text-faint)' }}>
          {formatDate(progress.startedAt, i18n.language, '')}
        </span>
      </div>

      {progress.error && (
        <div className="rounded-lg px-2.5 py-1.5 text-xs" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>
          {progress.error}
        </div>
      )}
    </div>
  );
}

function AccountCard({
  overview,
  progress,
  onEdit,
  onFolders,
  onChanged,
}: {
  overview: AccountOverview;
  progress: SyncProgress | undefined;
  onEdit: () => void;
  onFolders: () => void;
  onChanged: () => void;
}): ReactNode {
  const { t, i18n } = useTranslation();
  const account = overview.account;
  const running = overview.running || (progress ? !['done', 'failed', 'cancelled'].includes(progress.phase) : false);
  const lastRun = overview.lastRun as { started_at?: string; status?: string } | null;

  const stats = [
    { icon: <Mail size={14} />, label: t('dashboard.messages'), value: overview.messageCount.toLocaleString(i18n.language) },
    { icon: <FolderTree size={14} />, label: t('dashboard.folders'), value: String(account.selectedFolders.length) },
    {
      icon: <CalendarClock size={14} />,
      label: t('dashboard.lastRun'),
      value: formatDate(lastRun?.started_at ?? null, i18n.language, t('dashboard.never')),
    },
  ];

  return (
    <Card className="animate-fade-up">
      <div className="flex flex-wrap items-start gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-semibold"
          style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
        >
          {account.name.slice(0, 2).toUpperCase()}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-semibold">{account.name}</span>
            {running ? (
              <span className="flex items-center gap-1.5">
                <span className="animate-pulse-ring h-2 w-2 rounded-full" style={{ background: 'var(--accent)' }} />
                <Badge tone="accent">{t('dashboard.running')}</Badge>
              </span>
            ) : (
              <Badge tone={lastRun?.status === 'failed' ? 'danger' : 'ok'}>
                {lastRun?.status === 'failed' ? t('progress.failed') : t('dashboard.idle')}
              </Badge>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 truncate text-xs" style={{ color: 'var(--text-muted)' }}>
            <Server size={12} />
            {account.username} · {account.host}:{account.port}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={onFolders}>
            <FolderTree size={15} />
            {t('dashboard.selectFolders')}
          </Button>
          {running ? (
            <Button onClick={() => void api.cancelSync(account.id)}>
              <Square size={14} />
              {t('dashboard.cancel')}
            </Button>
          ) : (
            <Button
              variant="primary"
              disabled={account.selectedFolders.length === 0}
              onClick={() => void api.startSync(account.id)}
            >
              <Play size={15} />
              {t('dashboard.backupNow')}
            </Button>
          )}
          <Button variant="ghost" onClick={onEdit} aria-label={t('dashboard.edit')}>
            <Pencil size={15} />
          </Button>
          <Button
            variant="ghost"
            aria-label={t('dashboard.delete')}
            onClick={() => {
              if (!window.confirm(t('dashboard.deleteConfirm', { name: account.name }))) return;
              void api.deleteAccount(account.id).then(onChanged);
            }}
          >
            <Trash2 size={15} style={{ color: 'var(--danger)' }} />
          </Button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-xl px-3 py-2.5" style={{ background: 'var(--surface-2)' }}>
            <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>
              {stat.icon}
              {stat.label}
            </div>
            <div className="mt-0.5 text-sm font-medium tabular-nums">{stat.value}</div>
          </div>
        ))}
      </div>

      {account.selectedFolders.length === 0 && !running && (
        <div className="mt-3 rounded-xl px-3 py-2 text-xs" style={{ background: 'var(--warn-soft)', color: 'var(--warn)' }}>
          {t('dashboard.noFolders')}
        </div>
      )}

      {progress && <ProgressSection progress={progress} />}
    </Card>
  );
}

export function Dashboard(): ReactNode {
  const { t } = useTranslation();
  const { accounts, progress, refreshAccounts } = useApp();
  const [formFor, setFormFor] = useState<AccountOverview | null | undefined>(undefined);
  const [foldersFor, setFoldersFor] = useState<AccountOverview | null>(null);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">{t('dashboard.title')}</h1>
        <Button variant="primary" onClick={() => setFormFor(null)}>
          <Plus size={16} />
          {t('nav.addAccount')}
        </Button>
      </div>

      {accounts.length === 0 ? (
        <EmptyState
          icon={<Mail size={22} />}
          title={t('dashboard.empty')}
          description={t('dashboard.emptyHint')}
          action={
            <Button variant="primary" onClick={() => setFormFor(null)}>
              <Plus size={16} />
              {t('nav.addAccount')}
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          {accounts.map((overview) => (
            <AccountCard
              key={overview.account.id}
              overview={overview}
              progress={progress[overview.account.id]}
              onEdit={() => setFormFor(overview)}
              onFolders={() => setFoldersFor(overview)}
              onChanged={() => void refreshAccounts()}
            />
          ))}
        </div>
      )}

      {formFor !== undefined && (
        <AccountForm
          open
          existing={formFor}
          onClose={() => setFormFor(undefined)}
          onSaved={() => void refreshAccounts()}
        />
      )}

      {foldersFor && (
        <FolderPicker
          open
          accountId={foldersFor.account.id}
          accountName={foldersFor.account.name}
          onClose={() => setFoldersFor(null)}
          onSaved={({ startSync }) => {
            const id = foldersFor.account.id;
            void refreshAccounts();
            if (startSync) void api.startSync(id);
          }}
        />
      )}
    </div>
  );
}

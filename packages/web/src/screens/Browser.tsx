import type { SearchHit } from '@amberchest/core';
import {
  Archive,
  ChevronRight,
  FileEdit,
  Folder,
  FolderOpen,
  Inbox,
  Mail,
  Paperclip,
  RefreshCw,
  Search as SearchIcon,
  Download,
  ExternalLink,
  FileText,
  Send,
  ShieldAlert,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { api, downloadUrl, isDesktop } from '../api/client.js';
import { ContextMenu, type ContextMenuItem, type ContextMenuState } from '../components/ContextMenu.js';
import {
  EMPTY_MESSAGE_FILTERS,
  MessageFilters,
  activeFilterCount,
  toSearchOptions,
  type MessageFilterValues,
} from '../components/MessageFilters.js';
import { Badge, Button, EmptyState, Input, cx } from '../components/ui.js';
import { useApp } from '../state.js';
import { DiscardFolderDialog } from './DiscardFolderDialog.js';
import { ExportDialog, type ExportSelection } from './ExportDialog.js';
import { MessageView } from './MessageView.js';
import { formatBytes } from './Overview.js';

const PAGE_SIZE = 100;

interface LocalFolder {
  path: string;
  name: string;
  delimiter: string;
  specialUse: string | null;
  messages: number;
  lastSync: string | null;
}

interface TreeNode extends LocalFolder {
  children: TreeNode[];
}

const SPECIAL_ICONS: Record<string, ReactNode> = {
  '\\Inbox': <Inbox size={14} />,
  '\\Sent': <Send size={14} />,
  '\\Drafts': <FileEdit size={14} />,
  '\\Trash': <Trash2 size={14} />,
  '\\Junk': <ShieldAlert size={14} />,
  '\\Archive': <Archive size={14} />,
};

/** Builds the nesting from the IMAP paths and their delimiter. */
function buildTree(folders: LocalFolder[]): TreeNode[] {
  const nodes = new Map<string, TreeNode>();
  const sorted = [...folders].sort((a, b) => a.path.localeCompare(b.path));
  for (const folder of sorted) nodes.set(folder.path, { ...folder, children: [] });

  const roots: TreeNode[] = [];
  for (const node of nodes.values()) {
    const cut = node.delimiter ? node.path.lastIndexOf(node.delimiter) : -1;
    const parent = cut > 0 ? nodes.get(node.path.slice(0, cut)) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

/**
 * The mailbox browser.
 *
 * Accounts and their folders on the left, the messages of the selected folder
 * on the right - the layout everybody already knows from their mail client,
 * for the times when searching is not what you want.
 */
/** Starts a download without leaving the page. */
function download(url: string): void {
  const link = document.createElement('a');
  link.href = url;
  link.download = '';
  link.click();
}

export function Browser(): ReactNode {
  const { t, i18n } = useTranslation();
  const { accounts } = useApp();

  const [folders, setFolders] = useState<Record<string, LocalFolder[]>>({});
  const [collapsedAccounts, setCollapsedAccounts] = useState<Set<string>>(new Set());
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<{ accountId: string; path: string } | null>(null);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [filter, setFilter] = useState('');
  const [filters, setFilters] = useState<MessageFilterValues>(EMPTY_MESSAGE_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [exporting, setExporting] = useState<ExportSelection | null>(null);
  const [discarding, setDiscarding] = useState<{
    accountId: string;
    path: string;
    messages: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<{ accountId: string; messageId: number } | null>(null);

  const loadFolders = useCallback(async (): Promise<void> => {
    const next: Record<string, LocalFolder[]> = {};
    for (const entry of accounts) {
      try {
        next[entry.account.id] = (await api.localFolders(entry.account.id)).filter(
          (folder) => folder.messages > 0 || folder.lastSync !== null,
        );
      } catch {
        next[entry.account.id] = [];
      }
    }
    setFolders(next);
  }, [accounts]);

  useEffect(() => {
    void loadFolders();
  }, [loadFolders]);

  // Open the first folder that actually holds something.
  useEffect(() => {
    if (active) return;
    for (const entry of accounts) {
      const list = folders[entry.account.id] ?? [];
      const first = list.find((folder) => folder.messages > 0);
      if (first) {
        setActive({ accountId: entry.account.id, path: first.path });
        return;
      }
    }
  }, [folders, accounts, active]);

  const filterCount = activeFilterCount(filters, false);

  const loadMessages = useCallback(
    async (nextOffset: number): Promise<void> => {
      if (!active) return;
      setBusy(true);
      try {
        const result = await api.search({
          q: filter,
          account: active.accountId,
          folders: [active.path],
          ...toSearchOptions(filters),
          limit: PAGE_SIZE,
          offset: nextOffset,
        });
        setTotal(result.total);
        setHits((current) => (nextOffset === 0 ? result.hits : [...current, ...result.hits]));
        setOffset(nextOffset);
      } finally {
        setBusy(false);
      }
    },
    [active, filter, filters],
  );

  useEffect(() => {
    setHits([]);
    void loadMessages(0);
  }, [loadMessages]);

  const trees = useMemo(() => {
    const result: Record<string, TreeNode[]> = {};
    for (const [accountId, list] of Object.entries(folders)) result[accountId] = buildTree(list);
    return result;
  }, [folders]);

  /** What a right click on a message offers. */
  const messageMenu = (hit: SearchHit): ContextMenuItem[] => {
    const base = `/accounts/${hit.accountId}/messages/${hit.messageId}`;
    const items: ContextMenuItem[] = [
      {
        key: 'eml',
        label: t('menu.saveEml'),
        icon: <Download size={14} />,
        onSelect: () => download(downloadUrl(`${base}/raw`)),
      },
      {
        key: 'pdf',
        label: t('menu.savePdf'),
        icon: <FileText size={14} />,
        onSelect: () => download(downloadUrl(`${base}/pdf`)),
      },
      {
        key: 'sender',
        label: t('menu.searchSender'),
        icon: <SearchIcon size={14} />,
        disabled: !hit.fromAddr,
        onSelect: () => {
          if (!hit.fromAddr) return;
          setFilters((current) => ({ ...current, from: hit.fromAddr as string }));
          setShowFilters(true);
        },
      },
    ];

    // Only the desktop app can hand a file to the system mail client.
    if (isDesktop) {
      items.unshift({
        key: 'open',
        label: t('menu.openInClient'),
        icon: <ExternalLink size={14} />,
        onSelect: () => {
          void api
            .openMessage(hit.accountId, hit.messageId)
            .catch((cause: Error) => setNotice(cause.message));
        },
      });
    }
    return items;
  };

  /** What a right click on a folder offers. */
  const folderMenu = (accountId: string, node: TreeNode): ContextMenuItem[] => [
    {
      key: 'attachments',
      label: t('menu.exportAttachments'),
      icon: <Paperclip size={14} />,
      onSelect: () => {
        void api
          .startExport(accountId, [node.path])
          .then(() => setNotice(t('menu.exportStarted')))
          .catch((cause: Error) => setNotice(cause.message));
      },
    },
    {
      key: 'export',
      label: t('menu.exportFolder'),
      icon: <Download size={14} />,
      onSelect: () =>
        setExporting({
          q: '',
          account: accountId,
          folders: [node.path],
          withAttachments: false,
          total: node.messages,
        }),
    },
    {
      key: 'discard',
      label: t('menu.discardFolder'),
      icon: <Trash2 size={14} />,
      danger: true,
      onSelect: () => setDiscarding({ accountId, path: node.path, messages: node.messages }),
    },
  ];

  const renderFolder = (accountId: string, node: TreeNode, depth: number): ReactNode => {
    const key = `${accountId}:${node.path}`;
    const isCollapsed = collapsedFolders.has(key);
    const isActive = active?.accountId === accountId && active.path === node.path;

    return (
      <div key={key}>
        <div
          className={cx('group flex items-center gap-1 rounded-lg pr-2 transition')}
          style={{
            background: isActive ? 'var(--accent-soft)' : undefined,
            paddingLeft: `${depth * 14 + 6}px`,
          }}
        >
          <button
            type="button"
            onClick={() =>
              setCollapsedFolders((current) => {
                const next = new Set(current);
                if (next.has(key)) next.delete(key);
                else next.add(key);
                return next;
              })
            }
            className={cx('flex h-5 w-4 items-center justify-center', node.children.length === 0 && 'invisible')}
            style={{ color: 'var(--text-faint)' }}
          >
            <ChevronRight size={13} style={{ transform: isCollapsed ? 'none' : 'rotate(90deg)' }} />
          </button>

          <button
            type="button"
            onClick={() => setActive({ accountId, path: node.path })}
            onContextMenu={(event) => {
              event.preventDefault();
              setActive({ accountId, path: node.path });
              setMenu({
                x: event.clientX,
                y: event.clientY,
                items: folderMenu(accountId, node),
              });
            }}
            className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left"
          >
            <span style={{ color: isActive ? 'var(--accent)' : 'var(--text-faint)' }}>
              {(node.specialUse && SPECIAL_ICONS[node.specialUse]) ??
                (node.children.length > 0 && !isCollapsed ? <FolderOpen size={14} /> : <Folder size={14} />)}
            </span>
            <span
              className="truncate text-xs"
              style={{ color: isActive ? 'var(--accent)' : 'var(--text)' }}
              title={node.path}
            >
              {node.name}
            </span>
            {node.messages > 0 && (
              <span className="ml-auto shrink-0 text-[11px] tabular-nums" style={{ color: 'var(--text-faint)' }}>
                {node.messages.toLocaleString(i18n.language)}
              </span>
            )}
          </button>
        </div>

        {!isCollapsed && node.children.map((child) => renderFolder(accountId, child, depth + 1))}
      </div>
    );
  };

  if (accounts.length === 0) {
    return (
      <EmptyState icon={<Mail size={22} />} title={t('dashboard.empty')} description={t('dashboard.emptyHint')} />
    );
  }

  return (
    // The screen claims the height the main area gives it, so the two panels
    // grow with the window instead of stopping at a guessed fraction of it.
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight">{t('browser.title')}</h1>
        <Button variant="ghost" onClick={() => void loadFolders()} aria-label={t('folders.reload')}>
          <RefreshCw size={14} />
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
        {/* folder tree */}
        <div
          className="max-h-64 w-full shrink-0 overflow-y-auto rounded-2xl border p-2 lg:max-h-none lg:w-64"
          style={{ background: 'var(--surface-1)' }}
        >
          {accounts.map((entry) => {
            const accountId = entry.account.id;
            const isCollapsed = collapsedAccounts.has(accountId);
            const tree = trees[accountId] ?? [];

            return (
              <div key={accountId} className="mb-2">
                <button
                  type="button"
                  onClick={() =>
                    setCollapsedAccounts((current) => {
                      const next = new Set(current);
                      if (next.has(accountId)) next.delete(accountId);
                      else next.add(accountId);
                      return next;
                    })
                  }
                  className="flex w-full items-center gap-1.5 rounded-lg px-1.5 py-1.5 text-left transition hover:bg-[var(--surface-2)]"
                >
                  <ChevronRight
                    size={13}
                    style={{ color: 'var(--text-faint)', transform: isCollapsed ? 'none' : 'rotate(90deg)' }}
                  />
                  <span
                    className="flex h-5 w-5 items-center justify-center rounded text-[9px] font-semibold"
                    style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                  >
                    {entry.account.name.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="truncate text-xs font-medium">{entry.account.name}</span>
                  <span className="ml-auto text-[11px] tabular-nums" style={{ color: 'var(--text-faint)' }}>
                    {entry.messageCount.toLocaleString(i18n.language)}
                  </span>
                </button>

                {!isCollapsed &&
                  (tree.length > 0 ? (
                    tree.map((node) => renderFolder(accountId, node, 0))
                  ) : (
                    <div className="px-3 py-2 text-[11px]" style={{ color: 'var(--text-faint)' }}>
                      {t('browser.nothingArchived')}
                    </div>
                  ))}
              </div>
            );
          })}
        </div>

        {/* message list */}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <SearchIcon
                size={14}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
                style={{ color: 'var(--text-faint)' }}
              />
              <Input
                value={filter}
                placeholder={t('browser.filter')}
                onChange={(event) => setFilter(event.target.value)}
                className="!py-1.5 !pl-9 !text-xs"
              />
            </div>
            <Button
              onClick={() => setShowFilters((value) => !value)}
              className="shrink-0 !py-1.5 !text-xs"
            >
              <SlidersHorizontal size={14} />
              {t('search.filters')}
              {filterCount > 0 && <Badge>{filterCount}</Badge>}
            </Button>
            <span className="shrink-0 text-xs tabular-nums" style={{ color: 'var(--text-faint)' }}>
              {t('browser.count', { count: total })}
            </span>
          </div>

          {showFilters && (
            // The folder is what was clicked in the tree, so the chips that
            // pick folders in the search have nothing to offer here.
            <MessageFilters filters={filters} onChange={setFilters} />
          )}

          <div
            className="min-h-0 flex-1 rounded-2xl border lg:overflow-y-auto"
            style={{ background: 'var(--surface-1)' }}
          >
            {hits.length === 0 && !busy ? (
              <div className="px-4 py-12 text-center text-xs" style={{ color: 'var(--text-faint)' }}>
                {active ? t('browser.emptyFolder') : t('browser.pickFolder')}
              </div>
            ) : (
              hits.map((hit) => {
                const unread = !hit.flags.includes('\\Seen');
                return (
                  <button
                    key={hit.messageId}
                    type="button"
                    onClick={() => setOpen({ accountId: hit.accountId, messageId: hit.messageId })}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setMenu({ x: event.clientX, y: event.clientY, items: messageMenu(hit) });
                    }}
                    className="flex w-full flex-col gap-0.5 border-b px-3 py-2 text-left transition last:border-b-0 hover:bg-[var(--surface-2)]"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    <div className="flex items-baseline gap-2">
                      <span
                        className="truncate text-sm"
                        style={{ fontWeight: unread ? 600 : 400 }}
                      >
                        {hit.subject || '—'}
                      </span>
                      {hit.attachmentCount > 0 && (
                        <Badge tone="accent">
                          <Paperclip size={9} />
                          {hit.attachmentCount}
                        </Badge>
                      )}
                      <span
                        className="ml-auto shrink-0 text-[11px] tabular-nums"
                        style={{ color: 'var(--text-faint)' }}
                      >
                        {new Date(hit.internalDate).toLocaleDateString(i18n.language, {
                          year: '2-digit',
                          month: '2-digit',
                          day: '2-digit',
                        })}
                      </span>
                    </div>
                    <div className="flex items-baseline gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                      <span className="truncate">{hit.fromAddr ?? '—'}</span>
                      <span className="ml-auto shrink-0" style={{ color: 'var(--text-faint)' }}>
                        {formatBytes(hit.size)}
                      </span>
                    </div>
                  </button>
                );
              })
            )}

            {hits.length < total && (
              <div className="flex justify-center p-3">
                <Button disabled={busy} onClick={() => void loadMessages(offset + PAGE_SIZE)}>
                  {t('search.loadMore')}
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      {open && (
        <MessageView accountId={open.accountId} messageId={open.messageId} onClose={() => setOpen(null)} />
      )}

      <ContextMenu state={menu} onClose={() => setMenu(null)} />

      {exporting && <ExportDialog selection={exporting} onClose={() => setExporting(null)} />}

      {discarding && (
        <DiscardFolderDialog
          accountId={discarding.accountId}
          path={discarding.path}
          messages={discarding.messages}
          onClose={() => setDiscarding(null)}
          onDone={(summary) => {
            setDiscarding(null);
            setNotice(summary);
            setActive(null);
            void loadFolders();
          }}
        />
      )}

      {notice && (
        <button
          type="button"
          onClick={() => setNotice(null)}
          className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-xl border px-4 py-2 text-xs shadow-lg"
          style={{ background: 'var(--surface-1)', borderColor: 'var(--border)' }}
        >
          {notice}
        </button>
      )}
    </div>
  );
}

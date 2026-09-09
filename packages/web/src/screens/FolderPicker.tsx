import type { FolderTreeNode } from '@amberchest/core';
import {
  Archive,
  Check,
  ChevronRight,
  FileEdit,
  Folder,
  FolderOpen,
  Inbox,
  RefreshCw,
  Send,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client.js';
import { Badge, Button, Modal, cx } from '../components/ui.js';

const SPECIAL_ICONS: Record<string, ReactNode> = {
  '\\Inbox': <Inbox size={15} />,
  '\\Sent': <Send size={15} />,
  '\\Drafts': <FileEdit size={15} />,
  '\\Trash': <Trash2 size={15} />,
  '\\Junk': <ShieldAlert size={15} />,
  '\\Archive': <Archive size={15} />,
};

function flatten(nodes: FolderTreeNode[], out: FolderTreeNode[] = []): FolderTreeNode[] {
  for (const node of nodes) {
    out.push(node);
    flatten(node.children, out);
  }
  return out;
}

function descendants(node: FolderTreeNode): string[] {
  return flatten(node.children).map((child) => child.path);
}

export function FolderPicker({
  open,
  accountId,
  accountName,
  onClose,
  onSaved,
}: {
  open: boolean;
  accountId: string;
  accountName: string;
  onClose: () => void;
  onSaved: (options: { startSync: boolean }) => void;
}): ReactNode {
  const { t } = useTranslation();
  const [tree, setTree] = useState<FolderTreeNode[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** True while the message counts are still being fetched. */
  const [counting, setCounting] = useState(false);

  /**
   * Loads in two steps.
   *
   * The plain folder list is one IMAP command and comes back quickly; the
   * message counts need a STATUS per folder, which on a real mailbox takes a
   * while. Showing the tree first and filling in the numbers afterwards beats
   * staring at an empty dialog.
   */
  const load = async (): Promise<void> => {
    setTree(null);
    setError(null);
    setCounting(false);

    try {
      const nodes = await api.folders(accountId, false);
      setTree(nodes);
      setSelected(new Set(flatten(nodes).filter((node) => node.selected).map((node) => node.path)));
    } catch (cause) {
      setError((cause as Error).message);
      return;
    }

    setCounting(true);
    try {
      const withCounts = await api.folders(accountId, true);
      // Keep whatever the user ticked while the counts were on their way.
      setTree(withCounts);
    } catch {
      // The tree is already usable; missing counts are not worth an error.
    } finally {
      setCounting(false);
    }
  };

  useEffect(() => {
    if (open) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, accountId]);

  const all = useMemo(() => (tree ? flatten(tree) : []), [tree]);
  const selectable = all.filter((node) => !node.noSelect);

  const toggle = (node: FolderTreeNode, checked: boolean): void => {
    setSelected((current) => {
      const next = new Set(current);
      const paths = [node.path, ...descendants(node)];
      for (const path of paths) {
        if (checked) next.add(path);
        else next.delete(path);
      }
      return next;
    });
  };

  const save = async (startSync: boolean): Promise<void> => {
    setBusy(true);
    try {
      await api.saveFolders(accountId, [...selected]);
      onSaved({ startSync });
      onClose();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const renderNode = (node: FolderTreeNode, depth: number): ReactNode => {
    const isCollapsed = collapsed.has(node.path);
    const checked = selected.has(node.path);
    const hasChildren = node.children.length > 0;

    return (
      <div key={node.path}>
        <div
          className="group flex items-center gap-2 rounded-xl px-2 py-1.5 transition hover:bg-[var(--surface-2)]"
          style={{ paddingLeft: `${depth * 18 + 8}px` }}
        >
          <button
            type="button"
            onClick={() =>
              setCollapsed((current) => {
                const next = new Set(current);
                if (next.has(node.path)) next.delete(node.path);
                else next.add(node.path);
                return next;
              })
            }
            className={cx('flex h-4 w-4 items-center justify-center', !hasChildren && 'invisible')}
            style={{ color: 'var(--text-faint)' }}
          >
            <ChevronRight size={14} style={{ transform: isCollapsed ? 'none' : 'rotate(90deg)' }} />
          </button>

          <button
            type="button"
            disabled={node.noSelect}
            onClick={() => toggle(node, !checked)}
            className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[6px] border transition disabled:opacity-30"
            style={{
              background: checked ? 'var(--accent)' : 'var(--surface-1)',
              borderColor: checked ? 'var(--accent)' : 'var(--border-strong)',
              color: 'var(--accent-text)',
            }}
          >
            {checked && <Check size={12} strokeWidth={3} />}
          </button>

          <span style={{ color: node.isNew ? 'var(--accent)' : 'var(--text-muted)' }}>
            {(node.specialUse && SPECIAL_ICONS[node.specialUse]) ??
              (hasChildren && !isCollapsed ? <FolderOpen size={15} /> : <Folder size={15} />)}
          </span>

          <button
            type="button"
            disabled={node.noSelect}
            onClick={() => toggle(node, !checked)}
            className="flex-1 truncate text-left text-sm"
            title={node.path}
          >
            {node.name}
          </button>

          {node.isNew && <Badge tone="accent">{t('folders.newBadge')}</Badge>}
          {node.messageCount !== null && (
            <span className="shrink-0 text-xs tabular-nums" style={{ color: 'var(--text-faint)' }}>
              {node.messageCount}
            </span>
          )}
        </div>

        {hasChildren && !isCollapsed && node.children.map((child) => renderNode(child, depth + 1))}
      </div>
    );
  };

  return (
    <Modal
      open={open}
      wide
      title={`${t('folders.title')} - ${accountName}`}
      onClose={onClose}
      footer={
        <>
          <span className="mr-auto text-xs" style={{ color: 'var(--text-faint)' }}>
            {t('folders.selected', { count: selected.size, total: selectable.length })}
          </span>
          <Button variant="ghost" onClick={onClose}>
            {t('folders.back')}
          </Button>
          <Button onClick={() => void save(false)} disabled={busy || !tree}>
            {t('folders.save')}
          </Button>
          <Button variant="primary" onClick={() => void save(true)} disabled={busy || !tree}>
            {t('folders.saveAndRun')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <p className="mr-auto text-xs" style={{ color: 'var(--text-muted)' }}>
            {t('folders.subtitle')}
          </p>
          <Button variant="ghost" onClick={() => setSelected(new Set(selectable.map((node) => node.path)))}>
            {t('folders.selectAll')}
          </Button>
          <Button variant="ghost" onClick={() => setSelected(new Set())}>
            {t('folders.selectNone')}
          </Button>
          <Button variant="ghost" onClick={() => void load()} aria-label={t('folders.reload')}>
            <RefreshCw size={14} className={counting ? 'animate-spin' : undefined} />
          </Button>
        </div>

        {error && (
          <div className="rounded-xl px-3 py-2 text-xs" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>
            {error}
          </div>
        )}

        {!tree && !error && (
          <div className="flex flex-col items-center gap-3 py-12" style={{ color: 'var(--text-muted)' }}>
            <div
              className="h-6 w-6 animate-spin rounded-full border-2 border-current border-t-transparent"
              style={{ color: 'var(--accent)' }}
            />
            <span className="text-sm">{t('folders.loading')}</span>
            <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
              {t('folders.loadingHint')}
            </span>
          </div>
        )}

        {tree && (
          <div className="rounded-2xl border p-1.5" style={{ background: 'var(--surface-1)' }}>
            {tree.map((node) => renderNode(node, 0))}
          </div>
        )}
      </div>
    </Modal>
  );
}

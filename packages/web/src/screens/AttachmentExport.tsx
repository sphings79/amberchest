import type { AttachmentSettings, FolderTreeNode } from '@mail-archiver/core';
import { CalendarRange, FileStack, FolderTree, Layers, Paperclip, RotateCcw, Square } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type AttachmentState } from '../api/client.js';
import { Badge, Button, Field, Input, Modal, ProgressBar, Select, Toggle, cx } from '../components/ui.js';
import { useApp } from '../state.js';
import { formatBytes } from './Overview.js';

type Layout = AttachmentSettings['layout'];

const LAYOUT_ICONS: Record<Layout, ReactNode> = {
  'folder-tree': <FolderTree size={16} />,
  flat: <Layers size={16} />,
  'year-month': <CalendarRange size={16} />,
  'per-message': <FileStack size={16} />,
};

function flatten(nodes: FolderTreeNode[], out: FolderTreeNode[] = []): FolderTreeNode[] {
  for (const node of nodes) {
    out.push(node);
    flatten(node.children, out);
  }
  return out;
}

export function AttachmentExport({
  accountId,
  accountName,
  selectedFolders,
  onClose,
}: {
  accountId: string;
  accountName: string;
  /** Folders the account archives, used for the folder restriction. */
  selectedFolders: string[];
  onClose: () => void;
}): ReactNode {
  const { t } = useTranslation();
  const { exportProgress, refreshAccounts } = useApp();

  const [state, setState] = useState<AttachmentState | null>(null);
  const [settings, setSettings] = useState<AttachmentSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const progress = exportProgress[accountId];
  const running =
    (state?.running ?? false) ||
    (progress ? !['done', 'failed', 'cancelled'].includes(progress.phase) : false);

  useEffect(() => {
    void api
      .attachments(accountId)
      .then((value) => {
        setState(value);
        setSettings(value.settings);
      })
      .catch((cause: Error) => setError(cause.message));
  }, [accountId]);

  const patch = (part: Partial<AttachmentSettings>): void =>
    setSettings((current) => (current ? { ...current, ...part } : current));

  const save = async (): Promise<void> => {
    if (!settings) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await api.updateAttachments(accountId, settings);
      setSettings(saved);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const startExport = async (): Promise<void> => {
    await save();
    try {
      await api.startExport(accountId);
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  const exportAgain = async (): Promise<void> => {
    if (!window.confirm(t('attachments.againConfirm'))) return;
    try {
      await api.resetExport(accountId);
      setState(await api.attachments(accountId));
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  const layouts: Array<{ id: Layout; label: string; hint: string }> = [
    { id: 'folder-tree', label: t('attachments.layoutTree'), hint: t('attachments.layoutTreeHint') },
    { id: 'flat', label: t('attachments.layoutFlat'), hint: t('attachments.layoutFlatHint') },
    { id: 'year-month', label: t('attachments.layoutDate'), hint: t('attachments.layoutDateHint') },
    { id: 'per-message', label: t('attachments.layoutMessage'), hint: t('attachments.layoutMessageHint') },
  ];

  return (
    <Modal
      open
      wide
      title={`${t('attachments.title')} - ${accountName}`}
      onClose={onClose}
      footer={
        <>
          {state && (
            <span className="mr-auto text-xs" style={{ color: 'var(--text-faint)' }}>
              {t('attachments.exported')}: {t('attachments.files', { count: state.files })} ·{' '}
              {formatBytes(state.bytes)}
            </span>
          )}
          <Button variant="ghost" onClick={() => void exportAgain()} disabled={running || !state}>
            <RotateCcw size={14} />
            {t('attachments.again')}
          </Button>
          <Button onClick={() => void save()} disabled={busy || !settings || running}>
            {t('attachments.save')}
          </Button>
          {running ? (
            <Button onClick={() => void api.cancelExport(accountId)}>
              <Square size={14} />
              {t('attachments.cancel')}
            </Button>
          ) : (
            <Button variant="primary" onClick={() => void startExport()} disabled={!settings}>
              <Paperclip size={15} />
              {t('attachments.start')}
            </Button>
          )}
        </>
      }
    >
      {!settings ? (
        <div className="py-10 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
          …
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {t('attachments.subtitle')}
          </p>

          {progress && (
            <div className="flex flex-col gap-2 rounded-xl p-3.5" style={{ background: 'var(--surface-2)' }}>
              <div className="flex items-center gap-2 text-xs">
                <span className="font-medium">{t(`attachments.phase.${progress.phase}`)}</span>
                {progress.currentFolder && running && (
                  <span className="truncate" style={{ color: 'var(--text-faint)' }}>
                    {progress.currentFolder}
                  </span>
                )}
                <span className="ml-auto tabular-nums" style={{ color: 'var(--text-faint)' }}>
                  {progress.stats.messagesDone} / {progress.stats.messagesTotal}
                </span>
              </div>
              <ProgressBar
                value={
                  progress.stats.messagesTotal > 0
                    ? progress.stats.messagesDone / progress.stats.messagesTotal
                    : 0
                }
                indeterminate={running && progress.stats.messagesTotal === 0}
              />
              <div className="flex flex-wrap gap-3 text-xs" style={{ color: 'var(--text-muted)' }}>
                <span>
                  <strong className="tabular-nums">{progress.stats.attachmentsFound}</strong>{' '}
                  {t('attachments.stats.found')}
                </span>
                <span>
                  <strong className="tabular-nums">{progress.stats.attachmentsWritten}</strong>{' '}
                  {t('attachments.stats.written')}
                </span>
                <span>
                  <strong className="tabular-nums">{progress.stats.attachmentsDeduplicated}</strong>{' '}
                  {t('attachments.stats.deduplicated')}
                </span>
                <span>
                  <strong className="tabular-nums">{progress.stats.attachmentsFiltered}</strong>{' '}
                  {t('attachments.stats.filtered')}
                </span>
                <span className="ml-auto">{formatBytes(progress.stats.bytesWritten)}</span>
              </div>
              {progress.error && (
                <div
                  className="rounded-lg px-2.5 py-1.5 text-xs"
                  style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}
                >
                  {progress.error}
                </div>
              )}
            </div>
          )}

          <Field label={t('attachments.target')} hint={t('attachments.targetHint')}>
            <Input
              value={settings.targetPath ?? ''}
              placeholder={progress?.targetPath ?? ''}
              onChange={(event) => patch({ targetPath: event.target.value || null })}
            />
          </Field>

          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
              {t('attachments.layout')}
            </span>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {layouts.map((layout) => {
                const active = settings.layout === layout.id;
                return (
                  <button
                    key={layout.id}
                    type="button"
                    onClick={() => patch({ layout: layout.id })}
                    className={cx('flex items-start gap-2.5 rounded-xl border p-3 text-left transition')}
                    style={{
                      background: active ? 'var(--accent-soft)' : 'var(--surface-2)',
                      borderColor: active ? 'var(--accent)' : 'var(--border)',
                    }}
                  >
                    <span style={{ color: active ? 'var(--accent)' : 'var(--text-muted)' }}>
                      {LAYOUT_ICONS[layout.id]}
                    </span>
                    <span className="flex flex-col gap-0.5">
                      <span
                        className="text-sm font-medium"
                        style={{ color: active ? 'var(--accent)' : 'var(--text)' }}
                      >
                        {layout.label}
                      </span>
                      <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
                        {layout.hint}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-3 rounded-2xl border p-4" style={{ background: 'var(--surface-2)' }}>
            <span className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
              {t('attachments.filters')}
            </span>

            <Toggle
              checked={settings.includeInline}
              onChange={(includeInline) => patch({ includeInline })}
              label={t('attachments.includeInline')}
              hint={t('attachments.includeInlineHint')}
            />

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label={t('attachments.minSize')} hint={t('attachments.minSizeHint')}>
                <Input
                  type="number"
                  min={0}
                  value={Math.round(settings.minSizeBytes / 1024)}
                  onChange={(event) => patch({ minSizeBytes: Number(event.target.value) * 1024 })}
                />
              </Field>
              <Field label={t('attachments.extensionMode')}>
                <Select
                  value={settings.extensionMode}
                  onChange={(event) =>
                    patch({ extensionMode: event.target.value as AttachmentSettings['extensionMode'] })
                  }
                >
                  <option value="all">{t('attachments.extensionAll')}</option>
                  <option value="include">{t('attachments.extensionInclude')}</option>
                  <option value="exclude">{t('attachments.extensionExclude')}</option>
                </Select>
              </Field>
              <Field label={t('attachments.extensions')} hint={t('attachments.extensionsHint')}>
                <Input
                  value={settings.extensions.join(', ')}
                  disabled={settings.extensionMode === 'all'}
                  onChange={(event) =>
                    patch({
                      extensions: event.target.value
                        .split(',')
                        .map((value) => value.trim().replace(/^\./, '').toLowerCase())
                        .filter(Boolean),
                    })
                  }
                />
              </Field>
            </div>

            <Toggle
              checked={settings.deduplicate && settings.layout !== 'per-message'}
              onChange={(deduplicate) => patch({ deduplicate })}
              label={t('attachments.deduplicate')}
              hint={
                settings.layout === 'per-message'
                  ? t('attachments.deduplicateOff')
                  : t('attachments.deduplicateHint')
              }
            />

            <Toggle
              checked={settings.writeManifest}
              onChange={(writeManifest) => patch({ writeManifest })}
              label={t('attachments.writeManifest')}
              hint={t('attachments.writeManifestHint')}
            />
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
              {t('attachments.folders')}
            </span>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => patch({ folders: [] })}
                className="rounded-full border px-3 py-1 text-xs transition"
                style={{
                  background: settings.folders.length === 0 ? 'var(--accent-soft)' : 'var(--surface-2)',
                  borderColor: settings.folders.length === 0 ? 'var(--accent)' : 'var(--border)',
                  color: settings.folders.length === 0 ? 'var(--accent)' : 'var(--text-muted)',
                }}
              >
                {t('attachments.foldersAll')}
              </button>
              {selectedFolders.map((path) => {
                const active = settings.folders.includes(path);
                return (
                  <button
                    key={path}
                    type="button"
                    onClick={() =>
                      patch({
                        folders: active
                          ? settings.folders.filter((value) => value !== path)
                          : [...settings.folders, path],
                      })
                    }
                    className="rounded-full border px-3 py-1 text-xs transition"
                    style={{
                      background: active ? 'var(--accent-soft)' : 'var(--surface-2)',
                      borderColor: active ? 'var(--accent)' : 'var(--border)',
                      color: active ? 'var(--accent)' : 'var(--text-muted)',
                    }}
                  >
                    {path}
                  </button>
                );
              })}
            </div>
            {settings.folders.length > 0 && (
              <Badge tone="accent">{t('attachments.foldersSome', { count: settings.folders.length })}</Badge>
            )}
          </div>

          {error && (
            <div
              className="rounded-xl px-3 py-2 text-xs"
              style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}
            >
              {error}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

export { flatten };

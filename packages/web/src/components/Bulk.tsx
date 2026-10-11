import { RotateCcw, Trash2, TriangleAlert, X } from 'lucide-react';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type BulkFilter, type BulkResult, type MessageRef } from '../api/client.js';
import { Button, Card } from './ui.js';

/** How many messages one request carries; the server caps it at 1000. */
const CHUNK = 500;

export const keyOf = (ref: MessageRef): string => `${ref.accountId}:${ref.messageId}`;

/**
 * The selection of a message list.
 *
 * Keyed by account and message rather than by position, so it survives
 * loading more rows. `allMatching` is the "select everything this search
 * finds" state: the rows beyond the loaded page are not in the map, which is
 * why the bulk action then goes by the filter instead of by the list.
 */
export function useSelection(items: MessageRef[]) {
  const [selected, setSelected] = useState<Map<string, MessageRef>>(new Map());
  const [allMatching, setAllMatching] = useState(false);
  const last = useRef<number | null>(null);

  const toggle = useCallback(
    (index: number, range: boolean): void => {
      const item = items[index];
      if (!item) return;
      setAllMatching(false);
      // Read before the update: the updater runs later, after `last` has moved.
      const anchor = range ? last.current : null;
      setSelected((current) => {
        const next = new Map(current);
        const turnOn = !current.has(keyOf(item));
        const from = anchor !== null ? Math.min(anchor, index) : index;
        const to = anchor !== null ? Math.max(anchor, index) : index;
        for (let i = from; i <= to; i += 1) {
          const entry = items[i];
          if (!entry) continue;
          if (turnOn) next.set(keyOf(entry), entry);
          else next.delete(keyOf(entry));
        }
        return next;
      });
      last.current = index;
    },
    [items],
  );

  const selectLoaded = useCallback((): void => {
    setSelected(new Map(items.map((item) => [keyOf(item), item])));
  }, [items]);

  const clear = useCallback((): void => {
    setSelected(new Map());
    setAllMatching(false);
    last.current = null;
  }, []);

  return {
    selected,
    has: (ref: MessageRef): boolean => selected.has(keyOf(ref)),
    refs: [...selected.values()],
    allMatching,
    setAllMatching,
    toggle,
    selectLoaded,
    clear,
  };
}

/** The checkbox in front of a row. Shift-click takes everything in between. */
export function RowCheck({
  checked,
  onToggle,
  label,
}: {
  checked: boolean;
  onToggle: (range: boolean) => void;
  label: string;
}): ReactNode {
  return (
    <input
      type="checkbox"
      checked={checked}
      aria-label={label}
      // The click, not the change: only the click event knows about shift.
      onClick={(event) => onToggle(event.shiftKey)}
      onChange={() => undefined}
      className="h-4 w-4 shrink-0 cursor-pointer accent-[var(--accent)]"
    />
  );
}

/**
 * The strip above a list while something is selected.
 *
 * Offers "all N matching" once the whole loaded page is selected and there is
 * more behind it - the case this exists for: a search for a sender that
 * finds four thousand newsletters has to be thrown out in one go, not 100
 * rows at a time.
 */
export function BulkBar({
  count,
  loaded,
  total,
  allMatching,
  onSelectLoaded,
  onSelectAllMatching,
  onClear,
  actionLabel,
  actionIcon,
  danger,
  onAction,
}: {
  count: number;
  loaded: number;
  total: number;
  allMatching: boolean;
  onSelectLoaded: () => void;
  onSelectAllMatching: () => void;
  onClear: () => void;
  actionLabel: string;
  actionIcon: ReactNode;
  danger?: boolean;
  onAction: () => void;
}): ReactNode {
  const { t, i18n } = useTranslation();
  const n = (value: number): string => value.toLocaleString(i18n.language);

  const wholePage = !allMatching && count === loaded && loaded > 0;
  const more = total > loaded;
  const active = count > 0;

  return (
    // Always on screen, with or without a selection: a strip that appears on
    // the first tick pushes the rows down by the height of itself, under the
    // pointer that is in the middle of ticking them.
    <div
      className="flex h-10 shrink-0 items-center gap-2 rounded-xl border px-3 text-xs"
      style={{
        background: active ? 'var(--accent-soft)' : 'var(--surface-1)',
        borderColor: 'var(--border)',
      }}
    >
      <RowCheck
        checked={active && (allMatching || count >= loaded)}
        label={t(active ? 'bulk.clear' : 'bulk.selectLoaded', { count: n(loaded) })}
        onToggle={() => (active ? onClear() : onSelectLoaded())}
      />

      {active ? (
        <span className="shrink-0 font-medium">
          {t('bulk.selected', { count: allMatching ? n(total) : n(count) })}
        </span>
      ) : (
        <span className="min-w-0 truncate" style={{ color: 'var(--text-faint)' }}>
          {t('bulk.selectLoaded', { count: n(loaded) })}
        </span>
      )}

      {/* One line, whatever is offered: a strip that changes height moves the
          rows under the pointer. What does not fit is cut off. */}
      {active && count < loaded && (
        <button type="button" className="min-w-0 truncate underline" onClick={onSelectLoaded}>
          {t('bulk.selectLoaded', { count: n(loaded) })}
        </button>
      )}
      {wholePage && more && (
        <button type="button" className="min-w-0 truncate underline" onClick={onSelectAllMatching}>
          {t('bulk.selectAllMatching', { count: n(total) })}
        </button>
      )}

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <Button
          variant={danger ? 'danger' : 'secondary'}
          className="whitespace-nowrap !py-1 !text-xs"
          disabled={!active}
          onClick={onAction}
        >
          {actionIcon}
          {actionLabel}
        </Button>
        {active && (
          <Button variant="ghost" className="whitespace-nowrap !py-1 !text-xs" onClick={onClear} aria-label={t('bulk.clear')}>
            <X size={14} />
          </Button>
        )}
      </div>
    </div>
  );
}

export type BulkTarget =
  | { kind: 'messages'; refs: MessageRef[] }
  | { kind: 'filter'; filter: BulkFilter; total: number };

export type RestoreTarget =
  | { kind: 'messages'; refs: MessageRef[] }
  | { kind: 'filter'; filter: { account?: string; folder?: string; q?: string }; total: number };

/**
 * Confirms a bulk discard or restore and runs it.
 *
 * Says how many messages it is before asking, the way the folder dialog does.
 * A filter is worked off in batches and the dialog follows along, so a hundred
 * thousand matches show progress and can be stopped; what was done stays done.
 */
export function BulkDialog({
  mode,
  target,
  onClose,
  onDone,
}: {
  mode: 'discard' | 'restore';
  target: BulkTarget | RestoreTarget;
  onClose: () => void;
  onDone: (summary: string) => void;
}): ReactNode {
  const { t, i18n } = useTranslation();
  const n = (value: number): string => value.toLocaleString(i18n.language);

  const total = target.kind === 'messages' ? target.refs.length : target.total;
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const [failed, setFailed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);

  const run = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    cancelled.current = false;
    let processed = 0;
    let broken = 0;

    const step = (result: BulkResult): void => {
      processed += result.done;
      broken += result.failed;
      setDone(processed);
      setFailed(broken);
    };

    try {
      if (target.kind === 'messages') {
        for (let start = 0; start < target.refs.length && !cancelled.current; start += CHUNK) {
          const chunk = target.refs.slice(start, start + CHUNK);
          step(
            mode === 'discard'
              ? await api.discardMessages(chunk)
              : await api.restoreMessages(chunk),
          );
        }
      } else {
        // Each call takes a batch off the front of the matches, so the same
        // request makes progress until there is nothing left - or until a
        // batch achieves nothing, which would otherwise never end.
        for (;;) {
          if (cancelled.current) break;
          const result =
            mode === 'discard'
              ? await api.discardMatching(target.filter as BulkFilter, CHUNK)
              : await api.restoreMatching(
                  target.filter as { account?: string; folder?: string; q?: string },
                  CHUNK,
                );
          step(result);
          if ((result.remaining ?? 0) === 0 || result.done === 0 || processed >= target.total) break;
        }
      }

      onDone(
        t(mode === 'discard' ? 'bulk.discardDone' : 'bulk.restoreDone', {
          count: n(processed),
          failed: broken,
        }),
      );
    } catch (cause) {
      setError((cause as Error).message);
      setBusy(false);
    }
  };

  const discard = mode === 'discard';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <Card className="flex w-full max-w-md flex-col gap-4">
        <div className="flex items-center gap-2.5">
          {discard ? (
            <TriangleAlert size={16} style={{ color: 'var(--danger)' }} />
          ) : (
            <RotateCcw size={16} style={{ color: 'var(--accent)' }} />
          )}
          <span className="text-sm font-medium">
            {t(discard ? 'bulk.discardTitle' : 'bulk.restoreTitle')}
          </span>
        </div>

        <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          {t(discard ? 'bulk.discardBody' : 'bulk.restoreBody', { count: n(total) })}
        </p>

        {busy && (
          <div className="flex flex-col gap-1.5">
            <div className="h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--surface-2)' }}>
              <div
                className="h-full transition-all"
                style={{
                  width: `${total > 0 ? Math.min(100, ((done + failed) / total) * 100) : 0}%`,
                  background: 'var(--accent)',
                }}
              />
            </div>
            <span className="text-[11px] tabular-nums" style={{ color: 'var(--text-faint)' }}>
              {t('bulk.progress', { done: n(done), total: n(total) })}
              {failed > 0 && ` · ${t('bulk.failed', { count: failed })}`}
            </span>
          </div>
        )}

        {error && (
          <div className="rounded-lg px-2.5 py-1.5 text-xs" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button
            onClick={() => {
              // Mid-run this stops after the batch in flight; what was done stays.
              if (busy) cancelled.current = true;
              else onClose();
            }}
          >
            {busy ? t('bulk.stop') : t('common.cancel')}
          </Button>
          <Button variant={discard ? 'danger' : 'primary'} onClick={() => void run()} disabled={busy}>
            {discard ? <Trash2 size={14} /> : <RotateCcw size={14} />}
            {t(discard ? 'bulk.discardConfirm' : 'bulk.restoreConfirm', { count: n(total) })}
          </Button>
        </div>
      </Card>
    </div>
  );
}

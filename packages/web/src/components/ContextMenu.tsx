import { useEffect, useRef, useState, type ReactNode } from 'react';

export interface ContextMenuItem {
  key: string;
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  /** Drawn in the warning colour and separated from what sits above it. */
  danger?: boolean;
  disabled?: boolean;
}

export interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

/**
 * The menu a right click opens.
 *
 * Placed at the pointer and pulled back inside the window when it would hang
 * over an edge, which is what happens on the last row of a long list. Closes
 * on Escape, on a click elsewhere and on a scroll, because a menu that stays
 * behind while the list moves points at the wrong row.
 */
export function ContextMenu({
  state,
  onClose,
}: {
  state: ContextMenuState | null;
  onClose: () => void;
}): ReactNode {
  const ref = useRef<HTMLDivElement | null>(null);
  /**
   * Null until the menu has been measured.
   *
   * The pointer is where it goes; only a menu that would hang over an edge
   * moves, and how wide it is depends on the labels, so that can only be known
   * after it is drawn. Falling back to the pointer for the first frame keeps
   * it from appearing in the corner and jumping.
   */
  const [adjusted, setAdjusted] = useState<{ x: number; y: number } | null>(null);
  const position = adjusted ?? (state ? { x: state.x, y: state.y } : { x: 0, y: 0 });

  useEffect(() => {
    setAdjusted(null);
  }, [state]);

  useEffect(() => {
    if (!state || !ref.current || adjusted) return;
    const box = ref.current.getBoundingClientRect();
    const x = Math.min(state.x, window.innerWidth - box.width - 8);
    const y = Math.min(state.y, window.innerHeight - box.height - 8);
    setAdjusted({ x: Math.max(8, x), y: Math.max(8, y) });
  }, [state, adjusted]);

  useEffect(() => {
    if (!state) return undefined;
    const close = (): void => onClose();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    // Capture, so a scroll inside any list closes it and not only the page.
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [state, onClose]);

  if (!state) return null;

  return (
    <>
      {/* Catches the click that dismisses the menu, including a right click. */}
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        onContextMenu={(event) => {
          event.preventDefault();
          onClose();
        }}
      />
      <div
        ref={ref}
        role="menu"
        className="fixed z-50 min-w-52 overflow-hidden rounded-xl border py-1 shadow-lg"
        style={{
          left: position.x,
          top: position.y,
          background: 'var(--surface-1)',
          borderColor: 'var(--border)',
        }}
      >
        {state.items.map((item, index) => {
          const previous = state.items[index - 1];
          return (
            <div key={item.key}>
              {item.danger && previous && !previous.danger && (
                <div className="my-1 h-px" style={{ background: 'var(--border)' }} />
              )}
              <button
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  onClose();
                  item.onSelect();
                }}
                className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-xs transition hover:bg-[var(--surface-2)] disabled:opacity-40 disabled:hover:bg-transparent"
                style={{ color: item.danger ? 'var(--danger)' : 'var(--text)' }}
              >
                {item.icon}
                {item.label}
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}

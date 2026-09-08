import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/** Height of the desktop title bar in pixels; the window chrome matches it. */
export const TITLE_BAR_HEIGHT = 38;

/**
 * Title bar for the frameless desktop window.
 *
 * The window has no system title bar (`titleBarStyle: hiddenInset`), so this
 * strip is what the user grabs to move the window. It leaves room on the left
 * for the traffic lights. In the browser and in the container it is not
 * rendered at all.
 */
export function TitleBar(): ReactNode {
  const { t } = useTranslation();

  return (
    <div
      className="drag-region flex shrink-0 items-center border-b select-none"
      style={{
        height: TITLE_BAR_HEIGHT,
        background: 'var(--surface-1)',
        // Space for the close/minimise/zoom buttons.
        paddingLeft: 78,
        paddingRight: 12,
      }}
    >
      <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
        {t('app.name')}
      </span>
      <span className="ml-2 text-xs" style={{ color: 'var(--text-faint)' }}>
        {t('app.tagline')}
      </span>
    </div>
  );
}

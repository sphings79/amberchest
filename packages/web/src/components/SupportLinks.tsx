import { Coffee, Star } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { COFFEE_URL, STAR_URL } from '../constants.js';

/**
 * The two small asks at the bottom of the sidebar.
 *
 * Deliberately quiet: an icon and a line of text, no banner. Links open in the
 * real browser, which the desktop shell takes care of.
 */
export function SupportLinks(): ReactNode {
  const { t } = useTranslation();

  const links = [
    { href: STAR_URL, icon: <Star size={14} />, label: t('support.star'), hint: t('support.starHint') },
    { href: COFFEE_URL, icon: <Coffee size={14} />, label: t('support.coffee'), hint: t('support.coffeeHint') },
  ];

  return (
    <div className="flex items-center gap-1 md:flex-col md:items-stretch">
      {links.map((link) => (
        <a
          key={link.href}
          href={link.href}
          target="_blank"
          rel="noreferrer noopener"
          title={link.hint}
          className="flex items-center gap-2 rounded-xl px-2.5 py-1.5 text-xs transition hover:bg-[var(--surface-2)]"
          style={{ color: 'var(--text-muted)' }}
        >
          <span style={{ color: 'var(--accent)' }}>{link.icon}</span>
          <span className="hidden truncate md:inline">{link.label}</span>
        </a>
      ))}
    </div>
  );
}

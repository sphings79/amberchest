import {
  BarChart3,
  Bot,
  FolderTree,
  HouseWifi,
  Inbox,
  LayoutDashboard,
  Lock,
  ScrollText,
  Trash2,
  Search as SearchIcon,
  Settings as SettingsIcon,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { api, isDesktop, setToken } from './api/client.js';
import { ConnectionSwitcher } from './components/ConnectionSwitcher.js';
import { SupportLinks } from './components/SupportLinks.js';
import { TitleBar } from './components/TitleBar.js';
import { Button, cx } from './components/ui.js';
import { Browser } from './screens/Browser.js';
import { Discarded } from './screens/Discarded.js';
import { Dashboard } from './screens/Dashboard.js';
import { GateScreen } from './screens/GateScreen.js';
import { HomeAssistant } from './screens/HomeAssistant.js';
import { Logs } from './screens/Logs.js';
import { Overview } from './screens/Overview.js';
import { Search } from './screens/Search.js';
import { Statistics } from './screens/Statistics.js';
import { McpScreen } from './screens/McpScreen.js';
import { Settings } from './screens/Settings.js';
import { useApp } from './state.js';

type View =
  | 'overview'
  | 'accounts'
  | 'browser'
  | 'search'
  | 'statistics'
  | 'discarded'
  | 'settings'
  | 'mcp'
  | 'homeassistant'
  | 'logs';

function Logo(): ReactNode {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 7.5 12 13l9-5.5" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="M7 17h5" strokeLinecap="round" />
    </svg>
  );
}

/** Wraps every screen so the desktop window can always be dragged. */
function Shell({ children }: { children: ReactNode }): ReactNode {
  return (
    <div
      className="flex h-full flex-col overflow-hidden"
      style={{ background: 'var(--surface-0)' }}
    >
      {isDesktop && <TitleBar />}
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>
  );
}

export function App(): ReactNode {
  const { t } = useTranslation();
  const { server, loading, accounts, refreshState } = useApp();
  const [view, setView] = useState<View>('overview');

  if (loading) {
    return (
      <Shell>
        <div className="flex h-full items-center justify-center" style={{ color: 'var(--text-faint)' }}>
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-current border-t-transparent" />
        </div>
      </Shell>
    );
  }

  if (!server?.authenticated || !server.unlocked) {
    return (
      <Shell>
        <GateScreen />
      </Shell>
    );
  }

  const items: Array<{ id: View; label: string; icon: ReactNode; badge?: number }> = [
    { id: 'overview', label: t('nav.overview'), icon: <LayoutDashboard size={16} /> },
    { id: 'accounts', label: t('nav.accounts'), icon: <Inbox size={16} />, badge: accounts.length },
    { id: 'browser', label: t('nav.browser'), icon: <FolderTree size={16} /> },
    { id: 'search', label: t('nav.search'), icon: <SearchIcon size={16} /> },
    { id: 'statistics', label: t('nav.statistics'), icon: <BarChart3 size={16} /> },
    { id: 'discarded', label: t('nav.discarded'), icon: <Trash2 size={16} /> },
    { id: 'settings', label: t('nav.settings'), icon: <SettingsIcon size={16} /> },
    { id: 'mcp', label: t('nav.mcp'), icon: <Bot size={16} /> },
    { id: 'homeassistant', label: t('nav.homeAssistant'), icon: <HouseWifi size={16} /> },
    { id: 'logs', label: t('nav.logs'), icon: <ScrollText size={16} /> },
  ];

  const lock = async (): Promise<void> => {
    await api.lock();
    if (server.authMode === 'password') setToken(null);
    await refreshState();
  };

  return (
    <Shell>
      <div className="flex h-full flex-col md:flex-row">
        <aside
          className="flex shrink-0 flex-row items-center gap-2 overflow-x-auto border-b px-4 py-3 md:w-60 md:flex-col md:items-stretch md:overflow-x-visible md:border-b-0 md:border-r md:px-3 md:py-4"
          style={{ background: 'var(--surface-1)' }}
        >
          <button
            type="button"
            onClick={() => setView('overview')}
            className="flex items-center gap-2.5 rounded-xl px-1 text-left transition hover:opacity-80 md:mb-5"
          >
            <span
              className="flex h-9 w-9 items-center justify-center rounded-xl"
              style={{ background: 'var(--accent)', color: 'var(--accent-text)' }}
            >
              <Logo />
            </span>
            <div className="hidden leading-tight md:block">
              <div className="text-sm font-semibold tracking-tight">{t('app.name')}</div>
              <div className="text-[10px]" style={{ color: 'var(--text-faint)' }}>
                {t('app.tagline')}
              </div>
            </div>
          </button>

          <nav className="ml-auto flex gap-1 md:ml-0 md:flex-col">
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setView(item.id)}
                className={cx(
                  'flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition',
                  view === item.id ? 'font-medium' : 'hover:bg-[var(--surface-2)]',
                )}
                style={
                  view === item.id
                    ? { background: 'var(--accent-soft)', color: 'var(--accent)' }
                    : { color: 'var(--text-muted)' }
                }
              >
                {item.icon}
                <span className="hidden md:inline">{item.label}</span>
                {item.badge !== undefined && item.badge > 0 && (
                  <span className="ml-auto hidden text-xs tabular-nums md:inline" style={{ color: 'var(--text-faint)' }}>
                    {item.badge}
                  </span>
                )}
              </button>
            ))}
          </nav>

          <div className="flex items-center gap-1 md:mt-auto md:flex-col md:items-stretch">
            <SupportLinks />
            <ConnectionSwitcher />
            <Button variant="ghost" onClick={() => void lock()} className="w-full justify-start">
              <Lock size={15} />
              <span className="hidden md:inline">{t('nav.lock')}</span>
            </Button>
          </div>
        </aside>

        <main
          className={cx(
            'flex min-h-0 flex-1 flex-col px-5 py-6 md:px-8 md:py-8',
            // From the two column layout upwards the mailbox divides the
            // height between its panels and scrolls inside them, so this
            // element must bound the height instead of growing with it. Below
            // that breakpoint the panels are stacked and this one scrolls -
            // clipping there would put half the messages out of reach.
            view === 'browser' ? 'overflow-y-auto lg:overflow-hidden' : 'overflow-y-auto',
          )}
        >
          <div
            className={cx(
              'mx-auto',
              // The mailbox is handed the full height so its panels can divide
              // it; every other screen keeps its readable column and grows.
              view === 'browser' ? 'flex min-h-0 w-full flex-1 flex-col' : 'max-w-5xl',
            )}
          >
            {view === 'overview' && <Overview onGoToAccounts={() => setView('accounts')} />}
            {view === 'accounts' && <Dashboard />}
            {view === 'browser' && <Browser />}
            {view === 'discarded' && <Discarded />}
            {view === 'search' && <Search />}
            {view === 'statistics' && <Statistics />}
            {view === 'settings' && <Settings />}
            {view === 'mcp' && <McpScreen />}
            {view === 'homeassistant' && <HomeAssistant />}
            {view === 'logs' && <Logs />}
          </div>
        </main>
      </div>
    </Shell>
  );
}

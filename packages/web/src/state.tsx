import type {
  BundleProgress,
  RestoreProgress,
  ExportProgress,
  IndexProgress,
  LogEntry,
  MigrationProgress,
  RemovalProgress,
  SyncProgress,
  TransferProgress,
  VerifyProgress,
} from '@amberchest/core';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  api,
  eventsUrl,
  type AccountOverview,
  type Appearance,
  type OperatorSettings,
  type ServerState,
} from './api/client.js';
import { setLanguage, type Language } from './i18n/index.js';

interface AppState {
  server: ServerState | null;
  accounts: AccountOverview[];
  progress: Record<string, SyncProgress>;
  exportProgress: Record<string, ExportProgress>;
  indexProgress: Record<string, IndexProgress>;
  /** Keyed by bundle id; export jobs are not tied to one account. */
  bundleProgress: Record<string, BundleProgress>;
  restoreProgress: RestoreProgress | null;
  migrationProgress: MigrationProgress | null;
  verifyProgress: Record<string, VerifyProgress>;
  removalProgress: Record<string, RemovalProgress>;
  transferProgress: TransferProgress | null;
  logs: LogEntry[];
  loading: boolean;
  error: string | null;
  refreshState: () => Promise<void>;
  refreshAccounts: () => Promise<void>;
  applySettings: (settings: OperatorSettings) => void;
}

const Context = createContext<AppState | null>(null);

/** Applies theme, accent and language to the document. */
function applyAppearance(settings: Appearance | null): void {
  const root = document.documentElement;
  const theme = settings?.theme ?? 'system';
  const resolved =
    theme === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : theme;
  root.dataset.theme = resolved;
  root.dataset.accent = settings?.accentColor ?? 'violet';
  if (settings?.language) setLanguage(settings.language as Language);
}

export function AppProvider({ children }: { children: ReactNode }): ReactNode {
  const [server, setServer] = useState<ServerState | null>(null);
  const [accounts, setAccounts] = useState<AccountOverview[]>([]);
  const [progress, setProgress] = useState<Record<string, SyncProgress>>({});
  const [exportProgress, setExportProgress] = useState<Record<string, ExportProgress>>({});
  const [indexProgress, setIndexProgress] = useState<Record<string, IndexProgress>>({});
  const [bundleProgress, setBundleProgress] = useState<Record<string, BundleProgress>>({});
  const [restoreProgress, setRestoreProgress] = useState<RestoreProgress | null>(null);
  const [migrationProgress, setMigrationProgress] = useState<MigrationProgress | null>(null);
  const [verifyProgress, setVerifyProgress] = useState<Record<string, VerifyProgress>>({});
  const [removalProgress, setRemovalProgress] = useState<Record<string, RemovalProgress>>({});
  const [transferProgress, setTransferProgress] = useState<TransferProgress | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  const refreshState = useCallback(async () => {
    try {
      const next = await api.state();
      setServer(next);
      applyAppearance(next.settings ?? next.appearance);
      setError(null);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshAccounts = useCallback(async () => {
    try {
      setAccounts(await api.accounts());
    } catch {
      // Locked or not authenticated - the gate screen takes over.
    }
  }, []);

  const applySettings = useCallback((settings: OperatorSettings) => {
    setServer((current) => (current ? { ...current, settings } : current));
    applyAppearance(settings);
  }, []);

  useEffect(() => {
    void refreshState();
  }, [refreshState]);

  useEffect(() => {
    if (!server?.unlocked || !server.authenticated) return;
    void refreshAccounts();
    // The log is for admins; a viewer is refused it.
    if (server.role !== 'viewer') void api.logs().then(setLogs).catch(() => undefined);
  }, [server?.unlocked, server?.authenticated, server?.role, refreshAccounts]);

  // Follow the system theme while "system" is selected.
  useEffect(() => {
    const appearance = server?.settings ?? server?.appearance ?? null;
    if (appearance?.theme !== 'system') return undefined;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (): void => applyAppearance(appearance);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [server?.settings, server?.appearance]);

  // Live events: progress and log lines.
  useEffect(() => {
    // With authMode "none" there is no token, so authentication alone gates it.
    if (!server?.authenticated) return undefined;
    let closed = false;
    let retry: number | undefined;

    const connect = async (): Promise<void> => {
      if (closed) return;

      // The ticket is single use, so every reconnect asks for a fresh one.
      let url: string;
      try {
        url = await eventsUrl();
      } catch {
        // Most likely the session ran out: let the gate screen take over.
        void refreshState();
        return;
      }
      if (closed) return;

      const socket = new WebSocket(url);
      socketRef.current = socket;

      socket.onmessage = (event) => {
        const message = JSON.parse(String(event.data)) as { type: string; payload: unknown };
        if (message.type === 'progress') {
          const value = message.payload as SyncProgress;
          setProgress((current) => ({ ...current, [value.accountId]: value }));
          if (value.phase === 'done' || value.phase === 'failed' || value.phase === 'cancelled') {
            void refreshAccounts();
          }
        } else if (message.type === 'export-progress') {
          const value = message.payload as ExportProgress;
          setExportProgress((current) => ({ ...current, [value.accountId]: value }));
          if (value.phase === 'done' || value.phase === 'failed' || value.phase === 'cancelled') {
            void refreshAccounts();
          }
        } else if (message.type === 'index-progress') {
          const value = message.payload as IndexProgress;
          setIndexProgress((current) => ({ ...current, [value.accountId]: value }));
          if (value.phase === 'done' || value.phase === 'failed' || value.phase === 'cancelled') {
            void refreshAccounts();
          }
        } else if (message.type === 'bundle-progress') {
          const value = message.payload as BundleProgress;
          setBundleProgress((current) => ({ ...current, [value.bundleId]: value }));
        } else if (message.type === 'restore-progress') {
          setRestoreProgress(message.payload as RestoreProgress);
        } else if (message.type === 'migration-progress') {
          setMigrationProgress(message.payload as MigrationProgress);
        } else if (message.type === 'verify-progress') {
          const value = message.payload as VerifyProgress;
          setVerifyProgress((current) => ({ ...current, [value.accountId]: value }));
        } else if (message.type === 'removal-progress') {
          const value = message.payload as RemovalProgress;
          setRemovalProgress((current) => ({ ...current, [value.accountId]: value }));
        } else if (message.type === 'transfer-progress') {
          setTransferProgress(message.payload as TransferProgress);
        } else if (message.type === 'log') {
          setLogs((current) => [...current.slice(-499), message.payload as LogEntry]);
        }
      };

      socket.onclose = () => {
        if (closed) return;
        retry = window.setTimeout(() => void connect(), 2000);
      };
    };

    void connect();
    return () => {
      closed = true;
      if (retry) window.clearTimeout(retry);
      socketRef.current?.close();
    };
  }, [server?.authenticated, refreshAccounts, refreshState]);

  const value = useMemo<AppState>(
    () => ({
      server,
      accounts,
      progress,
      exportProgress,
      indexProgress,
      bundleProgress,
      restoreProgress,
      migrationProgress,
      verifyProgress,
      removalProgress,
      transferProgress,
      logs,
      loading,
      error,
      refreshState,
      refreshAccounts,
      applySettings,
    }),
    [
      server,
      accounts,
      progress,
      exportProgress,
      indexProgress,
      bundleProgress,
      restoreProgress,
      migrationProgress,
      verifyProgress,
      removalProgress,
      transferProgress,
      logs,
      loading,
      error,
      refreshState,
      refreshAccounts,
      applySettings,
    ],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useApp(): AppState {
  const value = useContext(Context);
  if (!value) throw new Error('useApp must be used inside AppProvider');
  return value;
}

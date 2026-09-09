import type { MessageContent } from '@amberchest/core';
import {
  Download,
  ExternalLink,
  Eye,
  FileText,
  Moon,
  Paperclip,
  ShieldAlert,
  Sun,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { api, downloadUrl, isDesktop } from '../api/client.js';
import { Badge, Button, Modal, cx } from '../components/ui.js';
import { formatBytes } from './Overview.js';

type Mode = 'html' | 'text';

/**
 * Builds the document shown in the viewer iframe.
 *
 * The iframe is sandboxed without allow-scripts and without allow-same-origin,
 * and the CSP inside the document blocks everything that is not an inlined
 * image. Remote content is only reachable after the user asks for it.
 */
function buildDocument(html: string, allowRemote: boolean, dark: boolean): string {
  const imgSources = allowRemote ? "data: https: http:" : 'data:';
  const csp = [
    "default-src 'none'",
    `img-src ${imgSources}`,
    "style-src 'unsafe-inline'",
    'font-src data:',
    "form-action 'none'",
  ].join('; ');

  /*
   * Only the page around the message is themed, never the message itself.
   *
   * A mail brings its own colours and was written for a white background. What
   * can be done without wrecking it is to say which scheme this is - so a
   * sender who set nothing inherits readable defaults - and to leave anything
   * they did set alone. Forcing the rest, by inverting for instance, turns
   * logos inside out and makes light text on a light block invisible.
   */
  const scheme = dark
    ? { root: 'dark', text: '#e8eaf0', background: '#171a21', link: '#a78bfa' }
    : { root: 'light', text: '#171a21', background: '#ffffff', link: '#5b3fd6' };

  return `<!doctype html>
<html><head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<base target="_blank">
<style>
  :root { color-scheme: ${scheme.root}; }
  body { margin: 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
         font-size: 14px; line-height: 1.5; color: ${scheme.text}; background: ${scheme.background};
         overflow-wrap: break-word; }
  img { max-width: 100%; height: auto; }
  table { max-width: 100%; }
  a { color: ${scheme.link}; }
  pre { white-space: pre-wrap; }
</style>
</head><body>${html}</body></html>`;
}

/** Whether the application is currently showing its dark theme. */
function isDarkTheme(): boolean {
  return document.documentElement.dataset.theme === 'dark';
}

export function MessageView({
  accountId,
  messageId,
  onClose,
}: {
  accountId: string;
  messageId: number;
  onClose: () => void;
}): ReactNode {
  const { t, i18n } = useTranslation();
  const [message, setMessage] = useState<MessageContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [allowRemote, setAllowRemote] = useState(false);
  const [mode, setMode] = useState<Mode>('html');
  /** Follows the application theme, and can be flipped for one message. */
  const [dark, setDark] = useState(isDarkTheme);

  useEffect(() => {
    setMessage(null);
    setAllowRemote(false);
    setDark(isDarkTheme());
    api
      .message(accountId, messageId)
      .then((value) => {
        setMessage(value);
        setMode(value.html ? 'html' : 'text');
      })
      .catch((cause: Error) => setError(cause.message));
  }, [accountId, messageId]);

  const document = useMemo(() => {
    if (!message) return '';
    if (mode === 'text') {
      const escaped = (message.text ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      return buildDocument(`<pre>${escaped}</pre>`, false, dark);
    }
    return buildDocument(message.html ?? '', allowRemote, dark);
  }, [message, mode, allowRemote, dark]);

  const openExternally = async (): Promise<void> => {
    try {
      await api.openMessage(accountId, messageId);
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  return (
    <Modal open wide title={message?.subject ?? '…'} onClose={onClose}>
      {error && (
        <div className="rounded-xl px-3 py-2 text-xs" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      {message && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <span style={{ color: 'var(--text-faint)' }}>{t('message.from')}</span>
            <span className="truncate">{message.from ?? '—'}</span>
            <span style={{ color: 'var(--text-faint)' }}>{t('message.to')}</span>
            <span className="truncate">{message.to ?? '—'}</span>
            {message.cc && (
              <>
                <span style={{ color: 'var(--text-faint)' }}>{t('message.cc')}</span>
                <span className="truncate">{message.cc}</span>
              </>
            )}
            <span style={{ color: 'var(--text-faint)' }}>{t('message.date')}</span>
            <span>
              {new Date(message.date).toLocaleString(i18n.language, {
                dateStyle: 'full',
                timeStyle: 'short',
              })}
            </span>
            <span style={{ color: 'var(--text-faint)' }}>{t('message.folder')}</span>
            <span className="truncate">{message.folderPath}</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {message.html && message.text && (
              <div className="flex rounded-xl p-0.5" style={{ background: 'var(--surface-2)' }}>
                {(['html', 'text'] as Mode[]).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setMode(value)}
                    className={cx('rounded-lg px-2.5 py-1 text-xs transition')}
                    style={
                      mode === value
                        ? { background: 'var(--surface-1)', color: 'var(--text)' }
                        : { color: 'var(--text-muted)' }
                    }
                  >
                    {value === 'html' ? t('message.showHtml') : t('message.showText')}
                  </button>
                ))}
              </div>
            )}

            <Button
              onClick={() => setDark((value) => !value)}
              title={t('message.schemeHint')}
            >
              {dark ? <Sun size={15} /> : <Moon size={15} />}
              {dark ? t('message.showLight') : t('message.showDark')}
            </Button>

            <a href={downloadUrl(`/accounts/${accountId}/messages/${messageId}/raw`)} download>
              <Button>
                <Download size={15} />
                {t('message.download')}
              </Button>
            </a>

            <a href={downloadUrl(`/accounts/${accountId}/messages/${messageId}/pdf`)} download>
              <Button>
                <FileText size={15} />
                {t('export.asPdf')}
              </Button>
            </a>

            {isDesktop && (
              <Button onClick={() => void openExternally()} title={t('message.openHint')}>
                <ExternalLink size={15} />
                {t('message.openInClient')}
              </Button>
            )}

            {message.hasRemoteContent && !allowRemote && mode === 'html' && (
              <Button onClick={() => setAllowRemote(true)} title={t('message.remoteWarning')}>
                <Eye size={15} />
                {t('message.loadRemote')}
              </Button>
            )}
          </div>

          {message.hasRemoteContent && !allowRemote && mode === 'html' && (
            <div
              className="flex items-start gap-2 rounded-xl px-3 py-2 text-xs"
              style={{ background: 'var(--warn-soft)', color: 'var(--warn)' }}
            >
              <ShieldAlert size={14} className="mt-0.5 shrink-0" />
              <span>
                {t('message.remoteBlocked')} {t('message.remoteWarning')}
              </span>
            </div>
          )}

          {message.attachments.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                {t('message.attachments')}
              </span>
              <div className="flex flex-wrap gap-2">
                {message.attachments.map((attachment) => (
                  <a
                    key={attachment.index}
                    href={downloadUrl(
                      `/accounts/${accountId}/messages/${messageId}/attachments/${attachment.index}`,
                    )}
                    download={attachment.name}
                    className="flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs transition hover:brightness-110"
                    style={{ background: 'var(--surface-2)' }}
                  >
                    <Paperclip size={13} style={{ color: 'var(--accent)' }} />
                    <span className="max-w-[220px] truncate">{attachment.name}</span>
                    <span style={{ color: 'var(--text-faint)' }}>{formatBytes(attachment.size)}</span>
                    {attachment.inline && <Badge>inline</Badge>}
                  </a>
                ))}
              </div>
            </div>
          )}

          {message.html || message.text ? (
            <iframe
              title={message.subject ?? 'message'}
              srcDoc={document}
              // No allow-scripts and no allow-same-origin: the message cannot
              // reach the application or the network on its own.
              sandbox="allow-popups allow-popups-to-escape-sandbox"
              className="h-[52vh] w-full rounded-xl border"
              style={{ background: '#ffffff' }}
            />
          ) : (
            <div className="rounded-xl px-3 py-6 text-center text-xs" style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
              {t('message.noBody')}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

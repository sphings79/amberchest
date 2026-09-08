import { existsSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MailArchiverApp, logger } from '@mail-archiver/core';
import { AuthGuard, startServer, type RunningServer } from '@mail-archiver/server';
import { tmpdir } from 'node:os';
import { BrowserWindow, Menu, app, dialog, ipcMain, shell } from 'electron';
import { createServer } from 'node:http';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Catches an OAuth redirect on a loopback address.
 *
 * Google has no device flow for mailboxes, so the sign-in has to happen in a
 * browser. On the desktop the redirect can be caught here, which spares the
 * user copying an address back by hand.
 */
async function catchLoopbackRedirect(url: string, port: number): Promise<string> {
  if (!/^https:\/\//i.test(url)) throw new Error('The sign-in address has to be https');
  if (!Number.isInteger(port) || port < 1024 || port > 65_535) throw new Error('Bad port');

  return new Promise<string>((resolve, reject) => {
    const server = createServer((request, response) => {
      const landed = `http://127.0.0.1:${port}${request.url ?? '/'}`;
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(
        '<!doctype html><meta charset="utf-8"><title>Mail Archiver</title>' +
          '<style>body{font-family:system-ui,sans-serif;background:#0d0f14;color:#e8eaf0;' +
          'display:grid;place-items:center;height:100vh;margin:0}</style>' +
          '<p>You can close this tab and go back to Mail Archiver.</p>',
      );
      server.close();
      resolve(landed);
    });

    // Ten minutes is longer than any provider keeps a code alive.
    const timer = setTimeout(() => {
      server.close();
      reject(new Error('Nobody came back from the sign-in page'));
    }, 600_000);
    server.on('close', () => clearTimeout(timer));
    server.on('error', (error) => reject(error));

    server.listen(port, '127.0.0.1', () => {
      void shell.openExternal(url);
    });
  });
}

let mainWindow: BrowserWindow | null = null;
let running: RunningServer | null = null;
let core: MailArchiverApp | null = null;

/**
 * The built frontend lives next to the compiled main process when packaged
 * and in the web workspace during development.
 */
function resolveWebRoot(): string {
  const fallback = resolve(here, '../../web/dist');
  const candidates = [join(process.resourcesPath ?? '', 'web'), resolve(here, '../web'), fallback];
  return candidates.find((candidate) => candidate.length > 0 && existsSync(candidate)) ?? fallback;
}

async function createWindow(url: string): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 900,
    minHeight: 620,
    title: 'Mail Archiver',
    // Only macOS gets the frameless look with the in-page title bar; Windows
    // and Linux keep their native window chrome, which is what users there
    // expect and what their window managers can snap and tile.
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 14, y: 13 } }
      : {}),
    backgroundColor: '#0d0f14',
    show: false,
    webPreferences: {
      // The UI talks to the local HTTP server only; it needs no Node access.
      // The preload adds one thing a browser cannot do: catch an OAuth
      // redirect on a loopback address.
      preload: join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  ipcMain.removeHandler('oauth:loopback');
  ipcMain.handle('oauth:loopback', (_event, url: string, port: number) =>
    catchLoopbackRedirect(url, port),
  );
  ipcMain.removeHandler('oauth:port');
  // The ephemeral range, so it does not collide with a real service.
  ipcMain.handle('oauth:port', () => 49_152 + Math.floor(Math.random() * 10_000));

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  // Links to the outside world open in the real browser, never in the app.
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    void shell.openExternal(target);
    return { action: 'deny' };
  });

  await mainWindow.loadURL(url);

  // Development helper: capture the window and exit. Used to verify the
  // window chrome without asking a human to look at the screen.
  const screenshotPath = process.env.MAIL_ARCHIVER_SCREENSHOT;
  if (screenshotPath) {
    const window = mainWindow;
    setTimeout(() => {
      void window.webContents.capturePage().then(async (image) => {
        await writeFile(screenshotPath, image.toPNG());
        app.quit();
      });
    }, 2500);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function buildMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/**
 * Renders HTML to PDF with the Chromium that Electron already contains.
 *
 * JavaScript is switched off and the window is offscreen, so printing a
 * message cannot execute anything the message brought with it.
 */
async function renderPdf(html: string): Promise<Buffer> {
  const file = join(tmpdir(), `mail-archiver-print-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
  await writeFile(file, html, 'utf8');

  const window = new BrowserWindow({
    show: false,
    width: 900,
    height: 1200,
    webPreferences: { javascript: false, sandbox: true, offscreen: true },
  });

  try {
    await window.loadFile(file);
    const pdf = await window.webContents.printToPDF({
      printBackground: true,
      margins: { top: 0.6, bottom: 0.6, left: 0.5, right: 0.5 },
      pageSize: 'A4',
    });
    return pdf;
  } finally {
    window.destroy();
    await rm(file, { force: true });
  }
}

async function start(): Promise<void> {
  core = new MailArchiverApp({ pdfRenderer: renderPdf });
  // A random token per launch; the window receives it in the URL and keeps it
  // in sessionStorage. Nothing on the machine can talk to the API without it.
  const auth = AuthGuard.withToken();

  running = await startServer({
    app: core,
    auth,
    webRoot: resolveWebRoot(),
    host: '127.0.0.1',
    port: 0,
    // Lets the UI hand an archived .eml to the system mail client, where the
    // user can reply or forward it as usual.
    openFile: async (path: string) => {
      const error = await shell.openPath(path);
      if (error) throw new Error(error);
    },
  });

  logger.info(`Local server ready on ${running.url}`);
  console.log(`Mail Archiver ready on ${running.url}`);
  // `desktop=1` makes the UI render its own title bar - only where the window
  // has none of its own.
  const chrome = process.platform === 'darwin' ? '&desktop=1' : '';
  await createWindow(`${running.url}/?token=${auth.token ?? ''}${chrome}`);
}

void app.whenReady().then(async () => {
  buildMenu();
  try {
    await start();
  } catch (error) {
    dialog.showErrorBox('Mail Archiver', `Start failed:\n\n${(error as Error).message}`);
    app.quit();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && running) {
      void createWindow(running.url);
    }
  });
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', () => {
  void running?.close();
  core?.close();
});

import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MailArchiverApp, logger } from '@mail-archiver/core';
import { AuthGuard, startServer, type RunningServer } from '@mail-archiver/server';
import { BrowserWindow, Menu, app, dialog, shell } from 'electron';

const here = dirname(fileURLToPath(import.meta.url));

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
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

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

async function start(): Promise<void> {
  core = new MailArchiverApp();
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

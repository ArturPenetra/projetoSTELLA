import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, session } from 'electron';
import { APP_NAME, isRequestAllowed } from '@stella/core';

const here = fileURLToPath(new URL('.', import.meta.url));
const isDev = !app.isPackaged && Boolean(process.env['ELECTRON_RENDERER_URL']);

/** 100% local: bloqueia qualquer requisição que saia do computador. */
function enforceLocalOnly(): void {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const allowed = isRequestAllowed(details.url);
    if (!allowed) console.warn(`[rede] bloqueado: ${details.url}`);
    callback({ cancel: !allowed });
  });
  // Nenhuma permissão do navegador (câmera, microfone, notificações...) é concedida por padrão.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) =>
    callback(false),
  );
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 420,
    height: 560,
    title: APP_NAME,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(here, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  win.once('ready-to-show', () => win.show());

  // O renderer nunca navega para fora do app nem abre janelas novas.
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  if (isDev) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'] as string);
  } else {
    void win.loadFile(join(here, '../renderer/index.html'));
  }
  return win;
}

app.setName(APP_NAME);

void app.whenReady().then(() => {
  enforceLocalOnly();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Links externos nunca são abertos automaticamente.
app.on('web-contents-created', (_e, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
});

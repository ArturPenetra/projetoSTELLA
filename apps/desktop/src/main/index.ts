import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, dialog, session } from 'electron';
import { APP_NAME, isRequestAllowed, OllamaClient } from '@stella/core';
import { loadConfig } from './config.js';
import { registerIpc } from './ipc.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const isDev = !app.isPackaged && Boolean(process.env['ELECTRON_RENDERER_URL']);

/** 100% local: bloqueia qualquer requisição do navegador que saia do computador. */
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
    width: 440,
    height: 640,
    minWidth: 340,
    minHeight: 420,
    title: APP_NAME,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0f1b33',
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

// Usado pelos testes de ponta a ponta para isolar config e dados numa pasta temporária.
const userDataOverride = process.env['STELLA_USER_DATA_DIR'];
if (userDataOverride) app.setPath('userData', userDataOverride);

void app.whenReady().then(async () => {
  enforceLocalOnly();
  const { config, warning } = await loadConfig(app.getPath('userData'));
  if (warning) {
    console.warn(`[config] ${warning}`);
    void dialog.showMessageBox({ type: 'warning', title: APP_NAME, message: warning });
  }

  const llm = new OllamaClient(config.llm);
  const win = createWindow();
  registerIpc(win, llm);
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('web-contents-created', (_e, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
});

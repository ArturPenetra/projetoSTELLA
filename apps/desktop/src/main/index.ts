import { app, BrowserWindow, dialog, session, type Tray } from 'electron';
import { APP_NAME, AvatarDirector, isRequestAllowed, OllamaClient } from '@stella/core';
import { IPC } from '../shared/ipc.js';
import { registerCompanionIpc } from './companion-ipc.js';
import { loadConfig } from './config.js';
import { registerChatIpc } from './ipc.js';
import { buildAppMenu, createTray, type AppMenuActions } from './tray.js';
import { CompanionStateStore } from './window-position.js';
import { companionPosition, createChatWindow, createCompanionWindow, showChat } from './windows.js';

const GREETING = `Oi! Eu sou a ${APP_NAME}. Clique em mim para conversar.`;

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

app.setName(APP_NAME);

// Usado pelos testes de ponta a ponta para isolar config e dados numa pasta temporária.
const userDataOverride = process.env['STELLA_USER_DATA_DIR'];
if (userDataOverride) app.setPath('userData', userDataOverride);

let quitting = false;
let tray: Tray | undefined;
let chatWindow: BrowserWindow | undefined;

// Só uma Stella por vez: abrir de novo traz o chat para frente.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (chatWindow) showChat(chatWindow);
  });
  void app.whenReady().then(start);
}

async function start(): Promise<void> {
  enforceLocalOnly();
  const userData = app.getPath('userData');
  const { config, warning } = await loadConfig(userData);
  if (warning) {
    console.warn(`[config] ${warning}`);
    void dialog.showMessageBox({ type: 'warning', title: APP_NAME, message: warning });
  }

  const store = new CompanionStateStore(userData);
  const saved = await store.load();
  const state = { ...saved };
  const persist = () => void store.save(state).catch((e) => console.warn('[companion]', e));

  const chat = createChatWindow(() => quitting);
  chatWindow = chat;
  const companion = createCompanionWindow(companionPosition(saved), saved.visible);

  const director = new AvatarDirector((snapshot) => {
    if (!companion.isDestroyed()) companion.webContents.send(IPC.avatarState, snapshot);
  });

  const actions: AppMenuActions = {
    openChat: () => showChat(chat),
    isCompanionVisible: () => companion.isVisible(),
    setCompanionVisible: (visible) => {
      if (visible) companion.showInactive();
      else companion.hide();
      state.visible = visible;
      persist();
    },
    quit: () => app.quit(),
  };

  registerChatIpc(chat, new OllamaClient(config.llm), director);
  registerCompanionIpc(companion, director, {
    openChat: actions.openChat,
    openMenu: () => buildAppMenu(actions).popup({ window: companion }),
    moved: (x, y) => {
      state.x = x;
      state.y = y;
      persist();
    },
  });
  tray = createTray(actions);

  if (saved.visible) {
    companion.webContents.once('did-finish-load', () => director.say(GREETING));
  } else {
    // Sem o avatar na tela, abre o chat para o app não parecer que não abriu.
    chat.once('ready-to-show', () => showChat(chat));
  }

  app.on('before-quit', () => {
    quitting = true;
    director.dispose();
    tray?.destroy();
  });
}

app.on('window-all-closed', () => {
  app.quit();
});

app.on('web-contents-created', (_e, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
});

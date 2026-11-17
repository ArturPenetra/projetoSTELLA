import { join } from 'node:path';
import { app, BrowserWindow, dialog, session, type Tray } from 'electron';
import {
  APP_NAME,
  AvatarDirector,
  FactExtractor,
  isRequestAllowed,
  Memory,
  MemoryStore,
  OllamaClient,
  type AppConfig,
  type Fact,
} from '@stella/core';
import { IPC } from '../shared/ipc.js';
import { registerCompanionIpc } from './companion-ipc.js';
import { loadConfig } from './config.js';
import { registerChatIpc } from './ipc.js';
import { registerMemoryIpc, toFactView } from './memory-ipc.js';
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

/** Espera máxima por uma extração de fatos em andamento ao fechar o app. */
const MEMORY_FLUSH_TIMEOUT_MS = 5000;

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

/**
 * Abre a memória (SQLite na pasta de dados). Se estiver desligada ou não abrir, o chat
 * continua funcionando sem ela e a tela de memória explica o motivo.
 */
function openMemory(
  config: AppConfig,
  chatLlm: OllamaClient,
  userData: string,
  onAdded: (facts: Fact[]) => void,
): { memory?: Memory; reason: string } {
  if (!config.memory.enabled) {
    return { reason: 'A memória está desligada (memory.enabled no config.json).' };
  }
  try {
    const store = new MemoryStore(join(userData, 'memoria.db'));
    const embedder = new OllamaClient({
      baseUrl: config.llm.baseUrl,
      model: config.memory.embeddingModel,
    });
    const memory = new Memory(store, embedder, new FactExtractor(chatLlm), {
      topK: config.memory.topK,
      onFactsAdded: onAdded,
    });
    return { memory, reason: '' };
  } catch (err) {
    console.error('[memória] não abriu', err);
    return { reason: 'Não consegui abrir o arquivo da memória. O chat funciona, mas sem lembrar.' };
  }
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

  const chatLlm = new OllamaClient(config.llm);
  const { memory, reason } = openMemory(config, chatLlm, userData, (facts) => {
    if (!chat.isDestroyed()) {
      chat.webContents.send(IPC.memoryEvent, { type: 'added', facts: facts.map(toFactView) });
    }
  });
  // Carrega o modelo de embedding em segundo plano: a frio ele leva vários segundos.
  void memory?.warmUp();

  registerChatIpc(chat, chatLlm, director, memory);
  registerMemoryIpc(chat, memory, reason);
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

  let memoryClosed = !memory;
  app.on('before-quit', (event) => {
    quitting = true;
    director.dispose();
    tray?.destroy();
    if (memoryClosed || !memory) return;
    // Termina de guardar o que a Stella acabou de aprender antes de fechar o banco.
    event.preventDefault();
    const timeout = new Promise((r) => setTimeout(r, MEMORY_FLUSH_TIMEOUT_MS));
    void Promise.race([memory.whenIdle(), timeout]).finally(() => {
      memoryClosed = true;
      try {
        memory.store.close();
      } catch (err) {
        console.warn('[memória] erro ao fechar', err);
      }
      app.quit();
    });
  });
}

app.on('window-all-closed', () => {
  app.quit();
});

app.on('web-contents-created', (_e, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
});

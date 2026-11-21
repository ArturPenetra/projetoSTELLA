import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, dialog, session, type Tray } from 'electron';
import {
  APP_NAME,
  AvatarDirector,
  createNameFixer,
  createOpenAppTool,
  createReadFileTool,
  FactExtractor,
  IntentRouter,
  isRequestAllowed,
  loadPersonaCatalog,
  Memory,
  MemoryStore,
  nameEntries,
  OllamaClient,
  ToolRunner,
  type AppConfig,
  type Fact,
} from '@stella/core';
import { IPC } from '../shared/ipc.js';
import { registerCompanionIpc } from './companion-ipc.js';
import { ConfirmBroker } from './confirm-broker.js';
import { registerToolsIpc } from './tools-ipc.js';
import { ToolLog, ToolSettingsStore } from './tools-store.js';
import { createWindowsLauncher, describeShortcut } from './windows-launcher.js';
import { loadConfig } from './config.js';
import { registerChatIpc } from './ipc.js';
import { registerMemoryIpc, toFactView } from './memory-ipc.js';
import { loadPalettes, PersonaService } from './persona-service.js';
import { registerPersonaIpc } from './persona-ipc.js';
import { ProfileStore } from './profile.js';
import { buildAppMenu, createTray, updateTray, type AppMenuActions } from './tray.js';
import { VOICE_MODELS, voiceForPersona, voiceModelsDir } from './voice-config.js';
import { VoiceEngineClient } from './voice-engine-client.js';
import { registerVoiceIpc } from './voice-ipc.js';
import { CompanionStateStore } from './window-position.js';
import { companionPosition, createChatWindow, createCompanionWindow, showChat } from './windows.js';

/** Raiz do projeto (personas/ e config/), a partir de out/main. */
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

/** O que o avatar diz antes do onboarding, enquanto a janela de boas-vindas está aberta. */
const ONBOARDING_HINT = 'Oi! Vamos nos conhecer? Abri uma janela pra você.';

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
  personaLabel: (personaId: string) => string | undefined,
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
      personaLabel,
    });
    return { memory, reason: '' };
  } catch (err) {
    console.error('[memória] não abriu', err);
    return { reason: 'Não consegui abrir o arquivo da memória. O chat funciona, mas sem lembrar.' };
  }
}

/** Personas são dados obrigatórios: sem elas o app não tem quem converse. */
function loadPersonas() {
  try {
    return {
      catalog: loadPersonaCatalog(join(ROOT, 'personas')),
      palettes: loadPalettes(join(ROOT, 'config', 'elements.json')),
    };
  } catch (err) {
    dialog.showErrorBox(
      APP_NAME,
      `Não consegui carregar as personas.\n\n${err instanceof Error ? err.message : String(err)}`,
    );
    app.exit(1);
    throw err;
  }
}

async function start(): Promise<void> {
  enforceLocalOnly();
  const userData = app.getPath('userData');
  const { catalog, palettes } = loadPersonas();
  const { config, warning } = await loadConfig(userData);
  if (warning) {
    console.warn(`[config] ${warning}`);
    void dialog.showMessageBox({ type: 'warning', title: APP_NAME, message: warning });
  }

  const store = new CompanionStateStore(userData);
  const saved = await store.load();
  // Tudo o que vem do disco é lido antes de criar as janelas: os canais de IPC são
  // registrados logo depois, antes de as páginas rodarem (senão os primeiros pedidos delas
  // se perdiam, como o nome da persona no balão).
  const profiles = new ProfileStore(userData);
  const profile = await profiles.load();
  const toolStore = new ToolSettingsStore(userData);
  await toolStore.load();
  const state = { ...saved };
  const persist = () => void store.save(state).catch((e) => console.warn('[companion]', e));

  const chat = createChatWindow(() => quitting);
  chatWindow = chat;
  const companion = createCompanionWindow(companionPosition(saved), saved.visible);

  const director = new AvatarDirector((snapshot) => {
    if (!companion.isDestroyed()) companion.webContents.send(IPC.avatarState, snapshot);
  });

  const chatLlm = new OllamaClient(config.llm);
  // A memória e as personas dependem uma da outra; as referências são preenchidas logo abaixo.
  const late: { personas?: PersonaService; chat?: ReturnType<typeof registerChatIpc> } = {};
  const { memory, reason } = openMemory(
    config,
    chatLlm,
    userData,
    (facts) => {
      if (!chat.isDestroyed()) {
        chat.webContents.send(IPC.memoryEvent, { type: 'added', facts: facts.map(toFactView) });
      }
    },
    (id) => late.personas?.label(id),
  );
  // Carrega o modelo de embedding em segundo plano: a frio ele leva vários segundos.
  void memory?.warmUp();

  const service = new PersonaService(catalog, palettes, profiles, profile, () => late.chat, memory);
  late.personas = service;

  const actions: AppMenuActions = {
    openChat: () => showChat(chat),
    personas: () => ({
      current: service.current,
      active: catalog.active(),
    }),
    selectPersona: (id) => {
      void service.select(id).catch((e: unknown) => console.warn('[personas]', e));
    },
    isCompanionVisible: () => companion.isVisible(),
    setCompanionVisible: (visible) => {
      if (visible) companion.showInactive();
      else companion.hide();
      state.visible = visible;
      persist();
    },
    quit: () => app.quit(),
  };

  // Ferramentas: tudo desligado até o usuário ligar. A pasta do app e a de dados nunca são
  // lidas, e toda ação passa pela confirmação no chat.
  const toolLog = new ToolLog(userData);
  const forbiddenDirs = [ROOT, userData];
  const broker = new ConfirmBroker(
    (prompt) => {
      if (chat.isDestroyed()) return;
      showChat(chat);
      chat.webContents.send(IPC.toolsConfirm, prompt);
    },
    (id) => {
      if (!chat.isDestroyed()) chat.webContents.send(IPC.toolsConfirmDismiss, id);
    },
  );
  const tools = new ToolRunner(
    [
      createReadFileTool({ forbiddenDirs }),
      createOpenAppTool({ launch: createWindowsLauncher(), describeShortcut }),
    ],
    {
      settings: () => toolStore.settings,
      confirm: (request, signal) => broker.ask(request, service.current.name, signal),
      // Quem decide as ações vê só a mensagem do usuário (nunca conteúdo de arquivos).
      router: new IntentRouter(chatLlm),
      log: (entry) => toolLog.append(entry),
    },
  );

  // Voz: desligada a cada abertura. Ligar cria a janela de áudio e o processo de voz;
  // desligar fecha os dois (a memória dos modelos volta ao sistema).
  const modelsDir = voiceModelsDir(ROOT);
  const voice = registerVoiceIpc({
    chat,
    companion,
    engine: (onText) =>
      new VoiceEngineClient({
        config: VOICE_MODELS,
        modelsDir,
        onText,
      }),
    send: (text) => late.chat?.send(text),
    busy: () => late.chat?.busy ?? false,
    cancelChat: () => late.chat?.cancelAll(),
    voiceFor: (id) => voiceForPersona(catalog.get(id)),
    // Nomes que o reconhecimento escreve errado (heardAs de cada persona + Stella).
    fixText: createNameFixer(nameEntries(catalog.all())),
  });

  late.chat = registerChatIpc(chat, chatLlm, director, {
    memory,
    speaker: service.speaker(),
    tools,
    onEvent: (event) => voice.chatEvent(event),
  });
  registerToolsIpc(chat, toolStore, toolLog, broker, forbiddenDirs);
  registerMemoryIpc(chat, memory, reason);
  registerPersonaIpc(chat, companion, service);
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
  service.onChanged((p) => {
    if (tray) updateTray(tray, p);
  });

  // As janelas começam a carregar antes das configurações serem lidas: se a página já
  // carregou, roda na hora; senão, quando terminar. (Esperar só o evento perdia o
  // cumprimento quando a janela carregava primeiro.)
  const whenLoaded = (win: BrowserWindow, run: () => void) => {
    if (win.isDestroyed()) return;
    if (!win.webContents.isLoading() && win.webContents.getURL()) run();
    else win.webContents.once('did-finish-load', run);
  };

  if (!service.onboarded) {
    // Primeira abertura: o chat abre com as boas-vindas e a escolha de persona.
    whenLoaded(chat, () => showChat(chat));
    whenLoaded(companion, () => director.say(ONBOARDING_HINT));
  } else if (saved.visible) {
    whenLoaded(companion, () => director.say(service.current.greeting));
  } else {
    // Sem o avatar na tela, abre o chat para o app não parecer que não abriu.
    whenLoaded(chat, () => showChat(chat));
  }

  let memoryClosed = !memory;
  app.on('before-quit', (event) => {
    quitting = true;
    broker.denyAll();
    voice.turnOff();
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

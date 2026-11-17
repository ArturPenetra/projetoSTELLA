import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, screen } from 'electron';
import { APP_NAME } from '@stella/core';
import { clampToScreens, defaultPosition, type Point } from './window-position.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const devUrl = !app.isPackaged ? process.env['ELECTRON_RENDERER_URL'] : undefined;

/** Tamanho da janela da companheira: balão em cima, avatar embaixo. */
export const COMPANION_SIZE = { width: 300, height: 460 } as const;

function secureWebPreferences(preload: string): Electron.WebPreferences {
  return {
    preload: join(here, `../preload/${preload}.cjs`),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
  };
}

function load(win: BrowserWindow, page: 'index' | 'companion'): void {
  // O renderer nunca navega para fora do app nem abre janelas novas.
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  if (devUrl) {
    void win.loadURL(page === 'index' ? devUrl : `${devUrl}/${page}.html`);
  } else {
    void win.loadFile(join(here, `../renderer/${page}.html`));
  }
}

/**
 * Janela de chat. Começa escondida; fechar só esconde (a Stella continua na bandeja).
 * `isQuitting` diz quando o app está saindo de verdade.
 */
export function createChatWindow(isQuitting: () => boolean): BrowserWindow {
  const win = new BrowserWindow({
    width: 440,
    height: 640,
    minWidth: 340,
    minHeight: 420,
    title: APP_NAME,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0f1b33',
    webPreferences: secureWebPreferences('chat'),
  });
  win.on('close', (event) => {
    if (!isQuitting()) {
      event.preventDefault();
      win.hide();
    }
  });
  load(win, 'index');
  return win;
}

export function showChat(win: BrowserWindow): void {
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

export function screenWorkAreas() {
  return screen.getAllDisplays().map((d) => d.workArea);
}

/** Posição salva, se ainda estiver numa tela; senão o canto inferior direito. */
export function companionPosition(saved: {
  x?: number | undefined;
  y?: number | undefined;
}): Point {
  if (saved.x !== undefined && saved.y !== undefined) {
    return clampToScreens({ x: saved.x, y: saved.y }, COMPANION_SIZE, screenWorkAreas());
  }
  return defaultPosition(screen.getPrimaryDisplay().workArea, COMPANION_SIZE);
}

/**
 * Janela do avatar: transparente, sem moldura, sempre no topo e fora da barra de tarefas.
 * `focusable: false` garante que ela nunca tira o foco do app que você está usando.
 * Fora do desenho do avatar, os cliques atravessam a janela (veja companion-ipc.ts).
 */
export function createCompanionWindow(position: Point, visible: boolean): BrowserWindow {
  const win = new BrowserWindow({
    ...COMPANION_SIZE,
    ...position,
    title: APP_NAME,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    webPreferences: secureWebPreferences('companion'),
  });
  win.setIgnoreMouseEvents(true, { forward: true });
  keepOnTop(win);
  win.once('ready-to-show', () => {
    if (visible) win.showInactive();
  });
  load(win, 'companion');
  return win;
}

/**
 * Mantém a janela sempre no topo. Medido no Windows 10 com um jogo aberto (League of
 * Legends): o nível padrão ("floating") era ignorado e a janela ficava atrás das outras;
 * o nível "screen-saver" funcionou. Se o Windows tirar o topo depois, ele volta.
 */
function keepOnTop(win: BrowserWindow): void {
  // As próprias chamadas de setAlwaysOnTop disparam 'always-on-top-changed'; sem esta
  // trava, desligar para religar virava um laço sem fim (a janela piscava e gastava CPU).
  let applying = false;
  // Se o Windows recusar várias vezes seguidas, para de insistir até a janela aparecer de novo.
  let retries = 0;
  const MAX_RETRIES = 5;
  const apply = (force: boolean) => {
    if (win.isDestroyed()) return;
    if (!force && win.isAlwaysOnTop()) {
      retries = 0;
      return;
    }
    applying = true;
    try {
      win.setAlwaysOnTop(false);
      win.setAlwaysOnTop(true, 'screen-saver');
    } finally {
      applying = false;
    }
  };
  apply(true);
  win.on('show', () => {
    retries = 0;
    apply(false);
  });
  win.on('always-on-top-changed', (_event, onTop) => {
    if (onTop || applying || retries >= MAX_RETRIES) return;
    retries++;
    setTimeout(() => apply(false), 250);
  });
}

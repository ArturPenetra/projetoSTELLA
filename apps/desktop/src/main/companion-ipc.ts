import { ipcMain, type BrowserWindow } from 'electron';
import type { AvatarDirector } from '@stella/core';
import { IPC } from '../shared/ipc.js';
import { assertSender, isFromWindow } from './ipc-guard.js';
import { clampToScreens } from './window-position.js';
import { COMPANION_SIZE, screenWorkAreas } from './windows.js';

export interface CompanionActions {
  openChat(): void;
  openMenu(): void;
  /** Chamado ao terminar um arraste, com a posição final. */
  moved(x: number, y: number): void;
}

/** Arraste máximo aceito numa mensagem (evita mandar a janela para muito longe). */
const MAX_DRAG = 20_000;

function isDelta(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= MAX_DRAG;
}

export function registerCompanionIpc(
  win: BrowserWindow,
  director: AvatarDirector,
  actions: CompanionActions,
): void {
  let dragOrigin: { x: number; y: number } | undefined;

  ipcMain.handle(IPC.avatarGet, (event) => {
    assertSender(event, win);
    return director.snapshot;
  });

  ipcMain.on(IPC.companionInteractive, (event, interactive: unknown) => {
    if (!isFromWindow(event, win) || typeof interactive !== 'boolean') return;
    // Fora do avatar, os cliques atravessam; `forward` continua mandando o movimento do mouse.
    win.setIgnoreMouseEvents(!interactive, { forward: true });
  });

  ipcMain.on(IPC.companionDragStart, (event) => {
    if (!isFromWindow(event, win)) return;
    const [x = 0, y = 0] = win.getPosition();
    dragOrigin = { x, y };
  });

  ipcMain.on(IPC.companionDragMove, (event, dx: unknown, dy: unknown) => {
    if (!isFromWindow(event, win) || !dragOrigin || !isDelta(dx) || !isDelta(dy)) return;
    win.setPosition(Math.round(dragOrigin.x + dx), Math.round(dragOrigin.y + dy));
  });

  ipcMain.on(IPC.companionDragEnd, (event) => {
    if (!isFromWindow(event, win) || !dragOrigin) return;
    dragOrigin = undefined;
    const [x = 0, y = 0] = win.getPosition();
    const fixed = clampToScreens({ x, y }, COMPANION_SIZE, screenWorkAreas());
    if (fixed.x !== x || fixed.y !== y) win.setPosition(fixed.x, fixed.y);
    actions.moved(fixed.x, fixed.y);
  });

  ipcMain.on(IPC.companionOpenChat, (event) => {
    if (isFromWindow(event, win)) actions.openChat();
  });

  ipcMain.on(IPC.companionBubbleClick, (event) => {
    if (!isFromWindow(event, win)) return;
    // Fala longa: o clique passa para a próxima página. Na última, abre o chat.
    if (!director.next()) actions.openChat();
  });

  ipcMain.on(IPC.companionMenu, (event) => {
    if (isFromWindow(event, win)) actions.openMenu();
  });
}

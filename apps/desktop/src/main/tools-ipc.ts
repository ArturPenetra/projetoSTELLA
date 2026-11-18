import { realpath } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { dialog, ipcMain, type BrowserWindow } from 'electron';
import { isInside, type ToolSettings } from '@stella/core';
import { IPC, type ToolsState } from '../shared/ipc.js';
import type { ConfirmBroker } from './confirm-broker.js';
import { assertSender } from './ipc-guard.js';
import { listStartMenuApps } from './start-menu.js';
import type { ToolLog, ToolSettingsStore } from './tools-store.js';

const view = (s: ToolSettings): ToolsState => ({
  enabled: { ...s.enabled },
  folders: [...s.folders],
  apps: s.apps.map((a) => ({ ...a })),
});

/**
 * Tela de ferramentas. Pastas e apps só entram pelo diálogo do sistema, aberto aqui no
 * processo principal: o renderer nunca manda um caminho para ser autorizado.
 */
export function registerToolsIpc(
  win: BrowserWindow,
  store: ToolSettingsStore,
  log: ToolLog,
  broker: ConfirmBroker,
  forbiddenDirs: string[],
): void {
  const update = async (change: (s: ToolSettings) => ToolSettings) => {
    await store.save(change(store.settings));
    return view(store.settings);
  };

  ipcMain.handle(IPC.toolsState, (event) => {
    assertSender(event, win);
    return view(store.settings);
  });

  ipcMain.handle(IPC.toolsSetEnabled, (event, tool: unknown, enabled: unknown) => {
    assertSender(event, win);
    if ((tool !== 'open_app' && tool !== 'read_file') || typeof enabled !== 'boolean') {
      throw new Error('Pedido inválido.');
    }
    return update((s) => ({ ...s, enabled: { ...s.enabled, [tool]: enabled } }));
  });

  ipcMain.handle(IPC.toolsAddFolder, async (event) => {
    assertSender(event, win);
    const result = await dialog.showOpenDialog(win, {
      title: 'Escolha uma pasta que a companheira pode ler',
      properties: ['openDirectory'],
    });
    const chosen = result.filePaths[0];
    if (result.canceled || !chosen) return view(store.settings);
    const real = await realpath(chosen);
    const forbidden = await Promise.all(forbiddenDirs.map((d) => realpath(d).catch(() => d)));
    if (forbidden.some((d) => isInside(real, d))) {
      throw new Error('Essa pasta é do próprio app e não pode ser autorizada.');
    }
    return update((s) =>
      s.folders.some((f) => f.toLowerCase() === real.toLowerCase())
        ? s
        : { ...s, folders: [...s.folders, real] },
    );
  });

  ipcMain.handle(IPC.toolsRemoveFolder, (event, path: unknown) => {
    assertSender(event, win);
    return update((s) => ({ ...s, folders: s.folders.filter((f) => f !== path) }));
  });

  ipcMain.handle(IPC.toolsAddApp, async (event) => {
    assertSender(event, win);
    const result = await dialog.showOpenDialog(win, {
      title: 'Escolha um programa que a companheira pode abrir',
      properties: ['openFile'],
      filters: [{ name: 'Programas', extensions: ['exe'] }],
    });
    const chosen = result.filePaths[0];
    if (result.canceled || !chosen) return view(store.settings);
    if (extname(chosen).toLowerCase() !== '.exe') {
      throw new Error('Escolha um programa (.exe). Para atalhos, use "Adicionar do Menu Iniciar".');
    }
    const name = basename(chosen, extname(chosen));
    return update((s) =>
      s.apps.some((a) => a.path.toLowerCase() === chosen.toLowerCase())
        ? s
        : { ...s, apps: [...s.apps, { name, path: chosen }] },
    );
  });

  ipcMain.handle(IPC.toolsStartMenu, async (event) => {
    assertSender(event, win);
    return listStartMenuApps();
  });

  // O renderer escolhe pelo caminho, mas só vale um atalho que está mesmo no Menu Iniciar.
  ipcMain.handle(IPC.toolsAddStartMenuApp, async (event, path: unknown) => {
    assertSender(event, win);
    const entry = (await listStartMenuApps()).find((e) => e.path === path);
    if (!entry) throw new Error('Esse atalho não está no Menu Iniciar.');
    return update((s) =>
      s.apps.some((a) => a.path.toLowerCase() === entry.path.toLowerCase())
        ? s
        : { ...s, apps: [...s.apps, { name: entry.name, path: entry.path }] },
    );
  });

  ipcMain.handle(IPC.toolsRemoveApp, (event, name: unknown) => {
    assertSender(event, win);
    return update((s) => ({ ...s, apps: s.apps.filter((a) => a.name !== name) }));
  });

  ipcMain.handle(IPC.toolsLog, (event) => {
    assertSender(event, win);
    return log.recent();
  });

  ipcMain.handle(IPC.toolsConfirmReply, (event, id: unknown, allow: unknown) => {
    assertSender(event, win);
    broker.answer(id, allow);
  });
}

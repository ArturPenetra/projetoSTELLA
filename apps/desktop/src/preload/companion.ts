import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { AvatarSnapshot } from '@stella/core';
import { IPC, type CompanionApi } from '../shared/ipc.js';

/** API da janela do avatar: só recebe o estado e avisa cliques e arrastes. */
const api: CompanionApi = {
  onState: (listener) => {
    const handler = (_e: IpcRendererEvent, state: AvatarSnapshot) => listener(state);
    ipcRenderer.on(IPC.avatarState, handler);
    void ipcRenderer.invoke(IPC.avatarGet).then(listener);
    return () => ipcRenderer.removeListener(IPC.avatarState, handler);
  },
  setInteractive: (interactive) => ipcRenderer.send(IPC.companionInteractive, interactive),
  dragStart: () => ipcRenderer.send(IPC.companionDragStart),
  dragMove: (dx, dy) => ipcRenderer.send(IPC.companionDragMove, dx, dy),
  dragEnd: () => ipcRenderer.send(IPC.companionDragEnd),
  openChat: () => ipcRenderer.send(IPC.companionOpenChat),
  openMenu: () => ipcRenderer.send(IPC.companionMenu),
};

contextBridge.exposeInMainWorld('companion', api);

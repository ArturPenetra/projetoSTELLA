import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC, type ChatEvent, type MemoryEvent, type StellaApi } from '../shared/ipc.js';

/** API mínima exposta ao renderer. Tudo passa pelo processo principal. */
const api: StellaApi = {
  appName: 'Stella',
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  llm: {
    status: () => ipcRenderer.invoke(IPC.llmStatus),
  },
  chat: {
    send: (text) => ipcRenderer.invoke(IPC.chatSend, text),
    cancel: (requestId) => ipcRenderer.invoke(IPC.chatCancel, requestId),
    reset: () => ipcRenderer.invoke(IPC.chatReset),
    onEvent: (listener) => {
      const handler = (_e: IpcRendererEvent, event: ChatEvent) => listener(event);
      ipcRenderer.on(IPC.chatEvent, handler);
      return () => ipcRenderer.removeListener(IPC.chatEvent, handler);
    },
  },
  memory: {
    status: () => ipcRenderer.invoke(IPC.memoryStatus),
    list: () => ipcRenderer.invoke(IPC.memoryList),
    update: (id, text) => ipcRenderer.invoke(IPC.memoryUpdate, id, text),
    delete: (id) => ipcRenderer.invoke(IPC.memoryDelete, id),
    clear: (options) => ipcRenderer.invoke(IPC.memoryClear, options),
    onEvent: (listener) => {
      const handler = (_e: IpcRendererEvent, event: MemoryEvent) => listener(event);
      ipcRenderer.on(IPC.memoryEvent, handler);
      return () => ipcRenderer.removeListener(IPC.memoryEvent, handler);
    },
  },
};

contextBridge.exposeInMainWorld('stella', api);

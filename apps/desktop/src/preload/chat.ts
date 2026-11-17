import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC, type ChatEvent, type StellaApi } from '../shared/ipc.js';

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
};

contextBridge.exposeInMainWorld('stella', api);

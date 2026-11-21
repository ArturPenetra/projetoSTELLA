import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  IPC,
  type ChatEvent,
  type ConfirmPrompt,
  type MemoryEvent,
  type PersonaView,
  type StellaApi,
} from '../shared/ipc.js';
import { VOICE_CHAT_IPC, type VoiceChatEvent } from '../shared/voice.js';

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
  personas: {
    state: () => ipcRenderer.invoke(IPC.personaState),
    select: (id) => ipcRenderer.invoke(IPC.personaSelect, id),
    suggest: (sign, preference) => ipcRenderer.invoke(IPC.personaSuggest, sign, preference),
    signsForDate: (day, month) => ipcRenderer.invoke(IPC.personaSignsForDate, day, month),
    finishOnboarding: (choice) => ipcRenderer.invoke(IPC.personaFinishOnboarding, choice),
    onChanged: (listener) => {
      const handler = (_e: IpcRendererEvent, persona: PersonaView) => listener(persona);
      ipcRenderer.on(IPC.personaChanged, handler);
      return () => ipcRenderer.removeListener(IPC.personaChanged, handler);
    },
  },
  tools: {
    state: () => ipcRenderer.invoke(IPC.toolsState),
    setEnabled: (tool, enabled) => ipcRenderer.invoke(IPC.toolsSetEnabled, tool, enabled),
    addFolder: () => ipcRenderer.invoke(IPC.toolsAddFolder),
    removeFolder: (path) => ipcRenderer.invoke(IPC.toolsRemoveFolder, path),
    addApp: () => ipcRenderer.invoke(IPC.toolsAddApp),
    startMenu: () => ipcRenderer.invoke(IPC.toolsStartMenu),
    addStartMenuApp: (path) => ipcRenderer.invoke(IPC.toolsAddStartMenuApp, path),
    removeApp: (name) => ipcRenderer.invoke(IPC.toolsRemoveApp, name),
    setAliases: (path, aliases) => ipcRenderer.invoke(IPC.toolsSetAliases, path, aliases),
    log: () => ipcRenderer.invoke(IPC.toolsLog),
    onConfirm: (listener) => {
      const handler = (_e: IpcRendererEvent, prompt: ConfirmPrompt) => listener(prompt);
      ipcRenderer.on(IPC.toolsConfirm, handler);
      return () => ipcRenderer.removeListener(IPC.toolsConfirm, handler);
    },
    onConfirmDismiss: (listener) => {
      const handler = (_e: IpcRendererEvent, id: string) => listener(id);
      ipcRenderer.on(IPC.toolsConfirmDismiss, handler);
      return () => ipcRenderer.removeListener(IPC.toolsConfirmDismiss, handler);
    },
    reply: (id, allow) => ipcRenderer.invoke(IPC.toolsConfirmReply, id, allow),
  },
  voice: {
    state: () => ipcRenderer.invoke(VOICE_CHAT_IPC.state),
    setEnabled: (enabled) => ipcRenderer.invoke(VOICE_CHAT_IPC.setEnabled, enabled),
    interrupt: () => ipcRenderer.invoke(VOICE_CHAT_IPC.interrupt),
    onEvent: (listener) => {
      const handler = (_e: IpcRendererEvent, event: VoiceChatEvent) => listener(event);
      ipcRenderer.on(VOICE_CHAT_IPC.event, handler);
      return () => ipcRenderer.removeListener(VOICE_CHAT_IPC.event, handler);
    },
  },
};

contextBridge.exposeInMainWorld('stella', api);

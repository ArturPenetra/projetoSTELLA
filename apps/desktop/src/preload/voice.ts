import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { VOICE_IPC, type PlayRequest, type VoiceIoApi } from '../shared/voice.js';

function isPlayRequest(value: unknown): value is PlayRequest {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['id'] === 'string' &&
    v['samples'] instanceof Float32Array &&
    typeof v['sampleRate'] === 'number' &&
    Number.isFinite(v['sampleRate']) &&
    v['sampleRate'] > 0
  );
}

/** API da janela de áudio: só microfone, reprodução e volume. Nada de chat, disco ou Ollama. */
const api: VoiceIoApi = {
  sendMicChunk: (chunk) => ipcRenderer.send(VOICE_IPC.micChunk, chunk),
  sendMicState: (state) => ipcRenderer.send(VOICE_IPC.micState, state),
  onPlay: (listener) => {
    const handler = (_e: IpcRendererEvent, req: unknown) => {
      if (isPlayRequest(req)) listener(req);
    };
    ipcRenderer.on(VOICE_IPC.play, handler);
    return () => ipcRenderer.removeListener(VOICE_IPC.play, handler);
  },
  onStop: (listener) => {
    const handler = () => listener();
    ipcRenderer.on(VOICE_IPC.stop, handler);
    return () => ipcRenderer.removeListener(VOICE_IPC.stop, handler);
  },
  sendPlayed: (event) => ipcRenderer.send(VOICE_IPC.played, event),
  sendLevel: (level) => ipcRenderer.send(VOICE_IPC.level, level),
};

contextBridge.exposeInMainWorld('voiceio', api);

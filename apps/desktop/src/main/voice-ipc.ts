import { ipcMain, type BrowserWindow, type IpcMainEvent } from 'electron';
import {
  MIC_CHUNK_SAMPLES,
  VOICE_CHAT_IPC,
  VOICE_IPC,
  type MicState,
  type PlayRequest,
  type VoiceChatEvent,
} from '../shared/voice.js';
import { assertSender, isFromWindow } from './ipc-guard.js';
import {
  VoiceController,
  type AudioIo,
  type VoiceChoice,
  type VoiceEngine,
} from './voice-controller.js';
import { allowMicFor, createVoiceWindow } from './voice-window.js';

/** Quanto esperar o microfone abrir (o Windows pode pedir permissão). */
const MIC_TIMEOUT_MS = 15_000;

/**
 * Janela de áudio (oculta): abre o microfone e toca as falas. Criada ao ligar a voz e
 * destruída ao desligar. Mensagens de qualquer outra janela nesses canais são ignoradas.
 */
class VoiceWindowAudio implements AudioIo {
  private win: BrowserWindow | undefined;
  private micState: ((state: MicState) => void) | undefined;

  constructor(
    private readonly handlers: {
      chunk: (chunk: Float32Array) => void;
      played: (id: string, state: 'start' | 'end') => void;
      level: (level: number) => void;
    },
  ) {
    const fromVoice = (event: IpcMainEvent) => !!this.win && isFromWindow(event, this.win);
    ipcMain.on(VOICE_IPC.micChunk, (event, chunk: unknown) => {
      if (!fromVoice(event)) return;
      if (chunk instanceof Float32Array && chunk.length === MIC_CHUNK_SAMPLES) {
        this.handlers.chunk(chunk);
      }
    });
    ipcMain.on(VOICE_IPC.micState, (event, state: MicState) => {
      if (fromVoice(event)) this.micState?.(state);
    });
    ipcMain.on(VOICE_IPC.played, (event, played: { id?: unknown; state?: unknown }) => {
      if (!fromVoice(event) || typeof played?.id !== 'string') return;
      if (played.state === 'start' || played.state === 'end') {
        this.handlers.played(played.id, played.state);
      }
    });
    ipcMain.on(VOICE_IPC.level, (event, level: unknown) => {
      if (fromVoice(event) && typeof level === 'number' && Number.isFinite(level)) {
        this.handlers.level(Math.min(1, Math.max(0, level)));
      }
    });
  }

  open(): Promise<void> {
    const win = createVoiceWindow();
    allowMicFor(win);
    this.win = win;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.micState = undefined;
        reject(new Error('O microfone não respondeu. Confira se ele está ligado.'));
      }, MIC_TIMEOUT_MS);
      this.micState = (state) => {
        // Depois de aberto, um erro (microfone desconectado) desliga a voz pelo controlador.
        clearTimeout(timer);
        this.micState = undefined;
        if (state.ok) resolve();
        else reject(new Error(state.error));
      };
    });
  }

  close(): void {
    const win = this.win;
    this.win = undefined;
    this.micState = undefined;
    if (win && !win.isDestroyed()) win.destroy();
  }

  play(req: PlayRequest): void {
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send(VOICE_IPC.play, req);
  }

  stop(): void {
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send(VOICE_IPC.stop);
  }
}

export interface RegisterVoiceOptions {
  chat: BrowserWindow;
  companion: BrowserWindow;
  /** Cria o motor (processo de voz); `onText` recebe o que o usuário falou. */
  engine: (onText: (text: string) => void) => VoiceEngine;
  send: (text: string) => void;
  busy: () => boolean;
  cancelChat: () => void;
  voiceFor: (speakerId: string) => VoiceChoice;
}

/** Liga a voz ao chat, à companheira (boca) e à janela de áudio. */
export function registerVoiceIpc(options: RegisterVoiceOptions): VoiceController {
  const { chat, companion } = options;
  const toChat = (event: VoiceChatEvent) => {
    if (!chat.isDestroyed()) chat.webContents.send(VOICE_CHAT_IPC.event, event);
  };
  const mouth = (level: number) => {
    if (!companion.isDestroyed()) companion.webContents.send(VOICE_IPC.mouth, level);
  };

  const controller: VoiceController = new VoiceController({
    engine: () => options.engine((text) => controller.heard(text)),
    audio: () =>
      new VoiceWindowAudio({
        chunk: (c) => controller.feed(c),
        played: (id, state) => {
          controller.played(id, state);
          if (state === 'end') mouth(0);
        },
        level: mouth,
      }),
    send: options.send,
    busy: options.busy,
    cancelChat: options.cancelChat,
    voiceFor: options.voiceFor,
    onState: (state) => {
      toChat({ type: 'state', state });
      if (state.status !== 'speaking') mouth(0);
    },
    onHeard: (text) => toChat({ type: 'heard', text }),
  });

  ipcMain.handle(VOICE_CHAT_IPC.state, (event) => {
    assertSender(event, chat);
    return controller.current;
  });
  ipcMain.handle(VOICE_CHAT_IPC.setEnabled, (event, enabled: unknown) => {
    assertSender(event, chat);
    if (typeof enabled !== 'boolean') throw new Error('Pedido inválido.');
    return enabled ? controller.turnOn() : controller.turnOff();
  });
  ipcMain.handle(VOICE_CHAT_IPC.interrupt, (event) => {
    assertSender(event, chat);
    controller.interrupt();
  });
  return controller;
}

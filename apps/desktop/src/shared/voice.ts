/**
 * Contrato da voz entre o processo principal e a janela de áudio (oculta, criada só quando
 * a voz está ligada e destruída ao desligar) e a janela da companheira (boca).
 *
 * Áudio do microfone: mono, 16 kHz, Float32 de -1 a 1, em pedaços de ~30 ms (512 amostras).
 * Áudio para tocar: mono, Float32, na taxa que o sintetizador gerar (ex.: 24000 Hz).
 */
export const VOICE_IPC = {
  /** janela de áudio → principal: um pedaço do microfone (Float32Array, 16 kHz). */
  micChunk: 'voice:mic-chunk',
  /** janela de áudio → principal: o microfone abriu ou falhou. */
  micState: 'voice:mic-state',
  /** principal → janela de áudio: toca este áudio depois dos que já estão na fila. */
  play: 'voice:play',
  /** principal → janela de áudio: para tudo agora e esvazia a fila (Esc, interrupção). */
  stop: 'voice:stop',
  /** janela de áudio → principal: um áudio começou ou terminou de tocar. */
  played: 'voice:played',
  /** janela de áudio → principal: volume do que está tocando (0 a 1, ~30 vezes por segundo). */
  level: 'voice:level',
  /** principal → companheira: volume atual da fala, para mexer a boca (0 = boca fechada). */
  mouth: 'voice:mouth',
} as const;

export const MIC_SAMPLE_RATE = 16_000;
export const MIC_CHUNK_SAMPLES = 512;

export type MicState = { ok: true } | { ok: false; error: string };

export interface PlayRequest {
  /** Identifica o pedaço (uma frase); volta em `played`. */
  id: string;
  samples: Float32Array;
  sampleRate: number;
}

export interface PlayedEvent {
  id: string;
  state: 'start' | 'end';
}

/** API da janela de áudio (window.voiceio). Não tem acesso ao chat, ao disco nem ao Ollama. */
export interface VoiceIoApi {
  sendMicChunk(chunk: Float32Array): void;
  sendMicState(state: MicState): void;
  onPlay(listener: (req: PlayRequest) => void): () => void;
  onStop(listener: () => void): () => void;
  sendPlayed(event: PlayedEvent): void;
  sendLevel(level: number): void;
}

/** Estados da voz, como a tela mostra. */
export type VoiceStatus =
  | 'off' // desligada (padrão a cada abertura)
  | 'loading' // carregando os modelos
  | 'listening' // ouvindo o microfone
  | 'thinking' // o usuário falou; esperando a resposta
  | 'speaking' // a persona está falando
  | 'error'; // não deu para ligar (modelos faltando, microfone negado)

export interface VoiceState {
  status: VoiceStatus;
  /** Motivo do erro, em pt-BR. */
  error?: string;
}

/** Canais da voz na janela de chat (window.stella.voice). */
export const VOICE_CHAT_IPC = {
  state: 'voice:state',
  setEnabled: 'voice:set-enabled',
  interrupt: 'voice:interrupt',
  /** principal → chat: estado novo ou fala ouvida. */
  event: 'voice:event',
} as const;

export type VoiceChatEvent = { type: 'state'; state: VoiceState } | { type: 'heard'; text: string };

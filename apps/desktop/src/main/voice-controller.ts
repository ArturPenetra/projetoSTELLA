import { createNameFixer, SentenceSplitter, speakable, STELLA_NAME } from '@stella/core';
import type { ChatEvent } from '../shared/ipc.js';
import type { PlayRequest, VoiceState, VoiceStatus } from '../shared/voice.js';

export type { VoiceState, VoiceStatus };

/** Sem a lista das personas, corrige só o nome do app ("Estela" → "Stella"). */
const fixStellaOnly = createNameFixer([STELLA_NAME]);

/** Voz de uma persona: quem fala e em que velocidade. */
export interface VoiceChoice {
  sid: number;
  speed: number;
}

/** O motor de voz (roda num processo separado; morto ao desligar). */
export interface VoiceEngine {
  /** Carrega os modelos. Rejeita com uma mensagem em pt-BR. */
  start(): Promise<void>;
  /** Encerra e libera a memória. */
  stop(): void;
  feed(chunk: Float32Array): void;
  /** Ignora o microfone (meio-duplex: enquanto a persona fala). */
  pauseListening(): void;
  resumeListening(): void;
  /** Sintetiza uma frase; undefined se não há o que falar ou foi cancelada. */
  synthesize(
    text: string,
    voice: VoiceChoice,
  ): Promise<{ samples: Float32Array; sampleRate: number } | undefined>;
  /** Descarta as frases que ainda não foram sintetizadas. */
  cancelSynthesis(): void;
}

/** Onde o áudio toca (a janela de áudio) e o microfone abre. */
export interface AudioIo {
  open(): Promise<void>;
  close(): void;
  play(req: PlayRequest): void;
  stop(): void;
}

export interface VoiceControllerOptions {
  engine: () => VoiceEngine;
  audio: () => AudioIo;
  /** Manda o texto ouvido ao chat (como se o usuário tivesse digitado). */
  send: (text: string) => void;
  /** Se o chat está respondendo agora. */
  busy: () => boolean;
  /** Cancela a resposta em andamento. */
  cancelChat: () => void;
  /** Voz da persona que está falando. */
  voiceFor: (speakerId: string) => VoiceChoice;
  onState: (state: VoiceState) => void;
  /** O usuário falou: mostrar no chat. */
  onHeard: (text: string) => void;
  /**
   * Corrige o texto ouvido antes de mandar ao chat (nomes das personas que o
   * reconhecimento escreve errado, `createNameFixer`). Padrão: só "Estela" → "Stella".
   */
  fixText?: (text: string) => string;
}

/**
 * Conversa falada. Liga e desliga o motor (os modelos só ficam na memória enquanto a voz
 * está ligada), manda o que foi ouvido ao chat e fala a resposta frase a frase enquanto o
 * modelo ainda escreve. Meio-duplex: o microfone fica surdo enquanto a persona fala (sem
 * isso, ela se ouve pelas caixas de som). Esc para tudo e volta a ouvir.
 */
export class VoiceController {
  private engine: VoiceEngine | undefined;
  private audio: AudioIo | undefined;
  private state: VoiceState = { status: 'off' };
  /** Resposta sendo falada agora. */
  private reply:
    { requestId: string; speakerId: string; splitter: SentenceSplitter; done: boolean } | undefined;
  /** Frases na fila de síntese (em ordem) e áudios tocando. */
  private queue: Promise<void> = Promise.resolve();
  private pending = 0;
  private playing = new Set<string>();
  private generation = 0;
  private seq = 0;

  constructor(private readonly options: VoiceControllerOptions) {}

  get current(): VoiceState {
    return this.state;
  }

  get enabled(): boolean {
    return this.state.status !== 'off' && this.state.status !== 'error';
  }

  private set(status: VoiceStatus, error?: string): void {
    this.state = error ? { status, error } : { status };
    this.options.onState(this.state);
  }

  async turnOn(): Promise<VoiceState> {
    if (this.enabled) return this.state;
    this.set('loading');
    const engine = this.options.engine();
    const audio = this.options.audio();
    this.engine = engine;
    this.audio = audio;
    try {
      await Promise.all([engine.start(), audio.open()]);
    } catch (err) {
      this.shutdown();
      this.set('error', err instanceof Error ? err.message : String(err));
      return this.state;
    }
    // Desligou enquanto carregava.
    if (this.engine !== engine) return this.state;
    this.set('listening');
    return this.state;
  }

  turnOff(): VoiceState {
    this.shutdown();
    this.set('off');
    return this.state;
  }

  private shutdown(): void {
    this.generation++;
    this.reply = undefined;
    this.pending = 0;
    this.playing.clear();
    this.engine?.stop();
    this.audio?.close();
    this.engine = undefined;
    this.audio = undefined;
  }

  /** Pedaço do microfone. */
  feed(chunk: Float32Array): void {
    this.engine?.feed(chunk);
  }

  /** O motor reconheceu uma fala do usuário. */
  heard(text: string): void {
    const clean = (this.options.fixText ?? fixStellaOnly)(text.trim()).trim();
    if (!this.enabled || !clean) return;
    if (this.state.status === 'speaking' || this.options.busy()) return;
    this.options.onHeard(clean);
    this.set('thinking');
    try {
      this.options.send(clean);
    } catch {
      this.set('listening');
    }
  }

  /** Esc: cala a persona, cancela a resposta e volta a ouvir. */
  interrupt(): void {
    if (!this.enabled) return;
    this.options.cancelChat();
    this.silence();
  }

  private silence(): void {
    this.generation++;
    this.reply = undefined;
    this.pending = 0;
    this.playing.clear();
    this.engine?.cancelSynthesis();
    this.audio?.stop();
    this.listen();
  }

  private listen(): void {
    if (!this.enabled) return;
    this.engine?.resumeListening();
    if (this.state.status !== 'listening') this.set('listening');
  }

  /** Eventos do chat (respostas a texto digitado também são faladas). */
  chatEvent(event: ChatEvent): void {
    if (!this.enabled || this.state.status === 'loading') return;
    switch (event.type) {
      case 'start':
        this.silence();
        this.reply = {
          requestId: event.requestId,
          speakerId: event.speaker.id,
          splitter: new SentenceSplitter(),
          done: false,
        };
        if (this.state.status !== 'thinking') this.set('thinking');
        break;
      case 'token':
        if (this.reply?.requestId !== event.requestId) return;
        for (const s of this.reply.splitter.push(event.text)) this.say(s);
        break;
      case 'done':
        if (this.reply?.requestId !== event.requestId) return;
        for (const s of this.reply.splitter.flush()) this.say(s);
        this.reply.done = true;
        this.maybeFinished();
        break;
      case 'error':
      case 'retract':
        if (this.reply?.requestId !== event.requestId) return;
        this.silence();
        break;
    }
  }

  private say(sentence: string): void {
    const reply = this.reply;
    const engine = this.engine;
    if (!reply || !engine || !speakable(sentence)) return;
    const generation = this.generation;
    const voice = this.options.voiceFor(reply.speakerId);
    this.pending++;
    // Uma frase por vez, na ordem: a próxima é sintetizada enquanto a anterior toca.
    this.queue = this.queue.then(async () => {
      try {
        if (generation !== this.generation) return;
        const audio = await engine.synthesize(sentence, voice).catch(() => undefined);
        if (generation !== this.generation || !audio) return;
        const id = `fala-${++this.seq}`;
        this.playing.add(id);
        if (this.state.status !== 'speaking') {
          engine.pauseListening();
          this.set('speaking');
        }
        this.audio?.play({ id, samples: audio.samples, sampleRate: audio.sampleRate });
      } finally {
        if (generation === this.generation) {
          this.pending--;
          this.maybeFinished();
        }
      }
    });
  }

  /** A janela de áudio avisou que um áudio terminou. */
  played(id: string, state: 'start' | 'end'): void {
    if (state !== 'end' || !this.playing.delete(id)) return;
    this.maybeFinished();
  }

  private maybeFinished(): void {
    if (!this.reply?.done || this.pending > 0 || this.playing.size > 0) return;
    this.reply = undefined;
    this.listen();
  }
}

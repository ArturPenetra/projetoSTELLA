import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatEvent } from '../shared/ipc.js';
import type { PlayRequest } from '../shared/voice.js';
import {
  VoiceController,
  type AudioIo,
  type VoiceChoice,
  type VoiceEngine,
  type VoiceStatus,
} from './voice-controller.js';

class FakeEngine implements VoiceEngine {
  started = false;
  stopped = false;
  listening = true;
  fed: Float32Array[] = [];
  said: { text: string; voice: VoiceChoice }[] = [];
  cancels = 0;
  fail: string | undefined;
  /** Cada síntese só termina quando o teste manda (para testar a ordem e o cancelamento). */
  release: (() => void)[] = [];
  manual = false;
  async start() {
    if (this.fail) throw new Error(this.fail);
    this.started = true;
  }
  stop() {
    this.stopped = true;
  }
  feed(chunk: Float32Array) {
    this.fed.push(chunk);
  }
  pauseListening() {
    this.listening = false;
  }
  resumeListening() {
    this.listening = true;
  }
  async synthesize(text: string, voice: VoiceChoice) {
    this.said.push({ text, voice });
    if (this.manual) await new Promise<void>((r) => this.release.push(r));
    return { samples: new Float32Array(10), sampleRate: 24000 };
  }
  cancelSynthesis() {
    this.cancels++;
  }
}

class FakeAudio implements AudioIo {
  opened = false;
  closed = false;
  played: PlayRequest[] = [];
  stops = 0;
  async open() {
    this.opened = true;
  }
  close() {
    this.closed = true;
  }
  play(req: PlayRequest) {
    this.played.push(req);
  }
  stop() {
    this.stops++;
  }
}

let engine: FakeEngine;
let audio: FakeAudio;
let states: VoiceStatus[];
let sent: string[];
let heard: string[];
let busy: boolean;
let cancels: number;
let voice: VoiceController;

const SPEAKER = { id: 'leo', name: 'Leo', element: 'fogo' as const };
const start = (requestId = 'r1'): ChatEvent => ({
  requestId,
  type: 'start',
  kind: 'reply',
  speaker: SPEAKER,
});
const token = (text: string, requestId = 'r1'): ChatEvent => ({ requestId, type: 'token', text });
const done = (requestId = 'r1'): ChatEvent => ({ requestId, type: 'done' });
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  engine = new FakeEngine();
  audio = new FakeAudio();
  states = [];
  sent = [];
  heard = [];
  busy = false;
  cancels = 0;
  voice = new VoiceController({
    engine: () => engine,
    audio: () => audio,
    send: (t) => sent.push(t),
    busy: () => busy,
    cancelChat: () => cancels++,
    voiceFor: (id) => (id === 'leo' ? { sid: 44, speed: 1.1 } : { sid: 43, speed: 1 }),
    onState: (s) => states.push(s.status),
    onHeard: (t) => heard.push(t),
  });
});

describe('VoiceController', () => {
  it('começa desligada; ligar carrega o motor e abre o microfone', async () => {
    expect(voice.current.status).toBe('off');
    await voice.turnOn();
    expect(engine.started && audio.opened).toBe(true);
    expect(states).toEqual(['loading', 'listening']);
  });

  it('desligar encerra o motor (libera a memória) e fecha o áudio', async () => {
    await voice.turnOn();
    voice.turnOff();
    expect(engine.stopped && audio.closed).toBe(true);
    expect(voice.current.status).toBe('off');
    // Desligada, nada passa.
    voice.feed(new Float32Array(1));
    voice.heard('oi');
    expect(engine.fed).toHaveLength(0);
    expect(sent).toEqual([]);
  });

  it('falha ao ligar: mostra o motivo e não deixa nada carregado', async () => {
    engine.fail = 'Modelo de voz não encontrado.';
    const state = await voice.turnOn();
    expect(state).toEqual({ status: 'error', error: 'Modelo de voz não encontrado.' });
    expect(engine.stopped && audio.closed).toBe(true);
  });

  it('o que o usuário fala vai ao chat e aparece na tela', async () => {
    await voice.turnOn();
    voice.heard('  Oi, Leo  ');
    expect(heard).toEqual(['Oi, Leo']);
    expect(sent).toEqual(['Oi, Leo']);
    expect(voice.current.status).toBe('thinking');
  });

  it('"Estela" ouvido vira Stella', async () => {
    await voice.turnOn();
    voice.heard('Oi, Estela, tudo bem?');
    expect(sent).toEqual(['Oi, Stella, tudo bem?']);
  });

  it('fala ouvida com o chat ocupado é ignorada', async () => {
    await voice.turnOn();
    busy = true;
    voice.heard('oi');
    expect(sent).toEqual([]);
  });

  it('fala a resposta frase a frase, com a voz da persona, e volta a ouvir no fim', async () => {
    await voice.turnOn();
    voice.chatEvent(start());
    voice.chatEvent(token('Oi! Tudo '));
    await flush();
    // A primeira frase já foi para a voz antes de a resposta terminar.
    expect(engine.said).toEqual([{ text: 'Oi!', voice: { sid: 44, speed: 1.1 } }]);
    expect(voice.current.status).toBe('speaking');
    expect(engine.listening).toBe(false);
    voice.chatEvent(token('bem? 😄'));
    voice.chatEvent(done());
    await flush();
    expect(engine.said.map((s) => s.text)).toEqual(['Oi!', 'Tudo bem?']);
    expect(audio.played).toHaveLength(2);
    voice.played(audio.played[0]?.id ?? '', 'end');
    expect(voice.current.status).toBe('speaking');
    voice.played(audio.played[1]?.id ?? '', 'end');
    expect(voice.current.status).toBe('listening');
    expect(engine.listening).toBe(true);
  });

  it('só emojis não vão para a voz', async () => {
    await voice.turnOn();
    voice.chatEvent(start());
    voice.chatEvent(token('🎉🎉'));
    voice.chatEvent(done());
    await flush();
    expect(engine.said).toEqual([]);
    expect(voice.current.status).toBe('listening');
  });

  it('Esc: cala, cancela a resposta e as frases pendentes, e volta a ouvir', async () => {
    await voice.turnOn();
    engine.manual = true;
    voice.chatEvent(start());
    voice.chatEvent(token('Primeira frase. Segunda frase. '));
    await flush();
    voice.interrupt();
    expect(cancels).toBe(1);
    expect(audio.stops).toBeGreaterThan(0);
    expect(engine.cancels).toBeGreaterThan(0);
    for (const r of engine.release) r();
    await flush();
    await flush();
    // O que terminou de sintetizar depois do Esc não toca.
    expect(audio.played).toEqual([]);
    expect(voice.current.status).toBe('listening');
  });

  it('resposta nova substitui a anterior; eventos de outra resposta são ignorados', async () => {
    await voice.turnOn();
    voice.chatEvent(start('r1'));
    voice.chatEvent(start('r2'));
    voice.chatEvent(token('Velha. ', 'r1'));
    voice.chatEvent(token('Nova. ', 'r2'));
    await flush();
    expect(engine.said.map((s) => s.text)).toEqual(['Nova.']);
  });

  it('resposta que falha ou é retirada para de falar', async () => {
    await voice.turnOn();
    voice.chatEvent(start());
    voice.chatEvent({ requestId: 'r1', type: 'retract' });
    expect(voice.current.status).toBe('listening');
    expect(audio.stops).toBeGreaterThan(0);
  });

  it('desligar enquanto carrega não deixa a voz ligada', async () => {
    let finish: () => void = () => undefined;
    engine.start = () => new Promise<void>((r) => (finish = r));
    const on = voice.turnOn();
    voice.turnOff();
    finish();
    await on;
    expect(voice.current.status).toBe('off');
    expect(vi.isMockFunction(engine.start)).toBe(false);
  });
});

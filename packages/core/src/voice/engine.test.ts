import { describe, expect, it, vi } from 'vitest';
import {
  cleanTranscript,
  Listener,
  Synthesizer,
  type RecognizerBackend,
  type SynthesizedAudio,
  type TtsBackend,
  type VadBackend,
  type Voice,
} from './engine.js';
import { toPhonemeCodepoints } from './sherpa.js';

/**
 * VAD falso: amostras com valor ≠ 0 são fala. A fala termina depois de `silence`
 * amostras de silêncio; o segmento é só a parte com fala.
 */
class FakeVad implements VadBackend {
  private current: number[] = [];
  private quiet = 0;
  private segments: Float32Array[] = [];
  resets = 0;

  constructor(private readonly silence = 512) {}

  acceptWaveform(samples: Float32Array): void {
    for (const s of samples) {
      if (s !== 0) {
        this.current.push(s);
        this.quiet = 0;
      } else if (this.current.length > 0 && ++this.quiet >= this.silence) {
        this.close();
      }
    }
  }

  isDetected(): boolean {
    return this.current.length > 0;
  }

  popSegments(): Float32Array[] {
    return this.segments.splice(0);
  }

  flush(): void {
    if (this.current.length > 0) this.close();
  }

  reset(): void {
    this.resets++;
    this.current = [];
    this.quiet = 0;
    this.segments = [];
  }

  private close(): void {
    this.segments.push(Float32Array.from(this.current));
    this.current = [];
    this.quiet = 0;
  }
}

/** Reconhecedor falso: o texto é o valor da primeira amostra ("fala 1", "fala 2"...). */
class FakeRecognizer implements RecognizerBackend {
  calls: number[] = [];
  texts = new Map<number, string>();
  delays = new Map<number, number>();
  fail = new Set<number>();

  async transcribe(samples: Float32Array): Promise<string> {
    const id = Math.round((samples[0] ?? 0) * 100);
    this.calls.push(id);
    await new Promise((r) => setTimeout(r, this.delays.get(id) ?? 0));
    if (this.fail.has(id)) throw new Error(`falhou ${id}`);
    return this.texts.get(id) ?? `fala ${id}`;
  }
}

const RATE = 16000;
const speech = (id: number, seconds: number) =>
  new Float32Array(Math.round(seconds * RATE)).fill(id / 100);
const silence = (seconds: number) => new Float32Array(Math.round(seconds * RATE));

function feedAll(listener: Listener, ...parts: Float32Array[]): void {
  for (const part of parts) {
    for (let i = 0; i < part.length; i += 512) listener.feed(part.subarray(i, i + 512));
  }
}

function setup(options = {}) {
  const vad = new FakeVad();
  const recognizer = new FakeRecognizer();
  const listener = new Listener(vad, recognizer, options);
  const events: string[] = [];
  listener.on('speech-start', () => events.push('start'));
  listener.on('speech-end', () => events.push('end'));
  listener.on('text', (t) => events.push(`text:${t}`));
  listener.on('error', (e) => events.push(`error:${(e as Error).message}`));
  return { vad, recognizer, listener, events };
}

describe('Listener', () => {
  it('avisa início e fim da fala e entrega a transcrição', async () => {
    const { listener, events } = setup();
    feedAll(listener, silence(0.2), speech(1, 0.5));
    expect(events).toEqual(['start']);
    expect(listener.isSpeaking).toBe(true);
    feedAll(listener, silence(0.1));
    expect(events).toEqual(['start', 'end']);
    await listener.idle();
    expect(events).toEqual(['start', 'end', 'text:fala 1']);
  });

  it('transcreve uma de cada vez, na ordem, mesmo se a primeira demorar', async () => {
    const { listener, recognizer, events } = setup();
    recognizer.delays.set(1, 30);
    feedAll(listener, speech(1, 0.5), silence(0.1), speech(2, 0.5), silence(0.1));
    expect(listener.pending).toBe(2);
    await listener.idle();
    expect(events.filter((e) => e.startsWith('text'))).toEqual(['text:fala 1', 'text:fala 2']);
    expect(listener.pending).toBe(0);
  });

  it('ignora falas curtas (tosse, clique)', async () => {
    const { listener, recognizer, events } = setup({ minSegmentSeconds: 0.3 });
    feedAll(listener, speech(1, 0.2), silence(0.1), speech(2, 0.35), silence(0.1));
    await listener.idle();
    expect(recognizer.calls).toEqual([2]);
    expect(events).toEqual(['start', 'end', 'start', 'end', 'text:fala 2']);
  });

  it('descarta transcrição vazia, só pontuação ou alucinação', async () => {
    const { listener, recognizer, events } = setup();
    recognizer.texts.set(1, '  ');
    recognizer.texts.set(2, '...');
    recognizer.texts.set(3, 'Legendas pela comunidade Amara.org');
    recognizer.texts.set(4, '[Música]');
    recognizer.texts.set(5, ' Oi,   Stella! ');
    for (const id of [1, 2, 3, 4, 5]) feedAll(listener, speech(id, 0.4), silence(0.1));
    await listener.idle();
    expect(events.filter((e) => e.startsWith('text'))).toEqual(['text:Oi, Stella!']);
  });

  it('pausado, o microfone é ignorado; a fala pela metade se perde', async () => {
    const { listener, recognizer, events, vad } = setup();
    feedAll(listener, speech(1, 0.4));
    listener.pause();
    expect(events).toEqual(['start', 'end']);
    expect(listener.isPaused).toBe(true);
    feedAll(listener, silence(0.1), speech(2, 0.5), silence(0.1));
    listener.flush();
    await listener.idle();
    expect(recognizer.calls).toEqual([]);
    listener.resume();
    expect(vad.resets).toBe(2);
    feedAll(listener, speech(3, 0.5), silence(0.1));
    await listener.idle();
    expect(events).toEqual(['start', 'end', 'start', 'end', 'text:fala 3']);
  });

  it('pausar não descarta a fala que já estava sendo transcrita', async () => {
    const { listener, recognizer, events } = setup();
    recognizer.delays.set(1, 20);
    feedAll(listener, speech(1, 0.5), silence(0.1));
    listener.pause();
    await listener.idle();
    expect(events).toContain('text:fala 1');
  });

  it('reset descarta as transcrições pendentes', async () => {
    const { listener, recognizer, events } = setup();
    recognizer.delays.set(1, 20);
    feedAll(listener, speech(1, 0.5), silence(0.1), speech(2, 0.5), silence(0.1));
    await new Promise((r) => setTimeout(r, 0)); // a 1 começa a ser transcrita
    feedAll(listener, speech(3, 0.2));
    listener.reset();
    await listener.idle();
    expect(recognizer.calls).toEqual([1]); // a 2 nem começou
    expect(events.filter((e) => e.startsWith('text'))).toEqual([]);
    expect(events.at(-1)).toBe('end');
    feedAll(listener, speech(4, 0.5), silence(0.1));
    await listener.idle();
    expect(events.at(-1)).toBe('text:fala 4');
  });

  it('flush transcreve a fala que não terminou em silêncio', async () => {
    const { listener, events } = setup();
    feedAll(listener, speech(1, 0.5));
    listener.flush();
    await listener.idle();
    expect(events).toEqual(['start', 'end', 'text:fala 1']);
  });

  it('erro na transcrição vira evento e o ouvinte continua', async () => {
    const { listener, recognizer, events } = setup();
    recognizer.fail.add(1);
    feedAll(listener, speech(1, 0.5), silence(0.1), speech(2, 0.5), silence(0.1));
    await listener.idle();
    expect(events.filter((e) => !['start', 'end'].includes(e))).toEqual([
      'error:falhou 1',
      'text:fala 2',
    ]);
  });

  it('ouvinte com defeito não quebra os outros; dá para desinscrever', async () => {
    const { listener } = setup();
    const seen: string[] = [];
    listener.on('text', () => {
      throw new Error('defeito');
    });
    const off = listener.on('text', (t) => seen.push(t));
    feedAll(listener, speech(1, 0.5), silence(0.1));
    await listener.idle();
    off();
    feedAll(listener, speech(2, 0.5), silence(0.1));
    await listener.idle();
    expect(seen).toEqual(['fala 1']);
  });

  it('segmento cortado no meio da fala (maxSpeechDuration) é transcrito sem fim de fala', async () => {
    const vad = new FakeVad();
    const recognizer = new FakeRecognizer();
    const listener = new Listener(vad, recognizer);
    const events: string[] = [];
    listener.on('speech-start', () => events.push('start'));
    listener.on('speech-end', () => events.push('end'));
    listener.on('text', (t) => events.push(t));
    // Simula o VAD entregando um segmento enquanto a fala continua.
    vi.spyOn(vad, 'popSegments').mockReturnValueOnce([speech(7, 0.5)]);
    feedAll(listener, speech(8, 0.032));
    await listener.idle();
    expect(events).toEqual(['start', 'fala 7']);
  });
});

describe('cleanTranscript', () => {
  it('limpa espaços e anotações', () => {
    expect(cleanTranscript('  Que  horas\nsão? (risos) ♪ ')).toBe('Que horas são?');
  });

  it('sem letras nem números não é fala', () => {
    expect(cleanTranscript('')).toBe('');
    expect(cleanTranscript(' . , ?! ')).toBe('');
    expect(cleanTranscript('[MÚSICA] ♪♪')).toBe('');
  });

  it('alucinações comuns do Whisper', () => {
    for (const text of [
      'Legendas pela comunidade Amara.org',
      'Legenda Adriana Zanotto',
      'Inscreva-se no canal!',
      'Obrigado por assistir.',
      'Transcrição e Legendas: Fulano',
    ]) {
      expect(cleanTranscript(text), text).toBe('');
    }
  });

  it('frases normais passam, inclusive "obrigado"', () => {
    expect(cleanTranscript('Obrigado.')).toBe('Obrigado.');
    expect(cleanTranscript('Me ajuda com a legenda do vídeo?')).toBe(
      'Me ajuda com a legenda do vídeo?',
    );
  });
});

/** Síntese falsa: devolve 100 amostras por letra; cada chamada espera o seu `release`. */
class FakeTts implements TtsBackend {
  readonly sampleRate = 24000;
  calls: { text: string; voice: Voice }[] = [];
  active = 0;
  maxActive = 0;
  private waiting: (() => void)[] = [];
  auto = true;
  failOn = new Set<string>();

  async generate(text: string, voice: Voice): Promise<SynthesizedAudio> {
    this.calls.push({ text, voice });
    this.active++;
    this.maxActive = Math.max(this.maxActive, this.active);
    if (!this.auto) await new Promise<void>((r) => this.waiting.push(r));
    else await new Promise((r) => setTimeout(r, 1));
    this.active--;
    if (this.failOn.has(text)) throw new Error(`não falou: ${text}`);
    return { samples: new Float32Array(text.length * 100), sampleRate: this.sampleRate };
  }

  release(): void {
    this.waiting.shift()?.();
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('Synthesizer', () => {
  const voice = { sid: 3, speed: 1 };

  it('limpa o texto e usa a voz padrão, ou a pedida', async () => {
    const tts = new FakeTts();
    const synth = new Synthesizer(tts, voice);
    const audio = await synth.synthesize('**Oi!** 🎉');
    expect(audio?.samples.length).toBe(300);
    expect(audio?.sampleRate).toBe(24000);
    await synth.synthesize('Tchau', { speed: 1.2 });
    expect(tts.calls).toEqual([
      { text: 'Oi!', voice },
      { text: 'Tchau', voice: { sid: 3, speed: 1.2 } },
    ]);
    expect(synth.sampleRate).toBe(24000);
  });

  it('nada para falar resolve undefined sem chamar a síntese', async () => {
    const tts = new FakeTts();
    const synth = new Synthesizer(tts, voice);
    await expect(synth.synthesize('🎉 ...')).resolves.toBeUndefined();
    await expect(synth.synthesize('')).resolves.toBeUndefined();
    expect(tts.calls).toEqual([]);
  });

  it('uma frase de cada vez, na ordem', async () => {
    const tts = new FakeTts();
    const synth = new Synthesizer(tts, voice);
    const done: string[] = [];
    const texts = ['Primeira.', 'Segunda.', 'Terceira.'];
    await Promise.all(texts.map((t) => synth.synthesize(t).then(() => done.push(t))));
    expect(tts.calls.map((c) => c.text)).toEqual(texts);
    expect(done).toEqual(texts);
    expect(tts.maxActive).toBe(1);
    expect(synth.pending).toBe(0);
  });

  it('cancel descarta a fila e o resultado da frase em andamento', async () => {
    const tts = new FakeTts();
    tts.auto = false;
    const synth = new Synthesizer(tts, voice);
    const a = synth.synthesize('Um.');
    const b = synth.synthesize('Dois.');
    const c = synth.synthesize('Três.');
    await tick();
    expect(synth.pending).toBe(3);
    synth.cancel();
    await expect(a).resolves.toBeUndefined();
    await expect(b).resolves.toBeUndefined();
    await expect(c).resolves.toBeUndefined();
    expect(synth.pending).toBe(1); // "Um." ainda gerando no nativo

    // A próxima frase espera a síntese cancelada terminar (uma de cada vez).
    const d = synth.synthesize('Quatro.');
    await tick();
    expect(tts.calls.map((x) => x.text)).toEqual(['Um.']);
    tts.release();
    await tick();
    expect(tts.calls.map((x) => x.text)).toEqual(['Um.', 'Quatro.']);
    tts.release();
    expect((await d)?.samples.length).toBe(700);
    expect(tts.maxActive).toBe(1);
  });

  it('erro rejeita só aquela frase; as próximas seguem', async () => {
    const tts = new FakeTts();
    tts.failOn.add('Ruim.');
    const synth = new Synthesizer(tts, voice);
    const bad = synth.synthesize('Ruim.');
    const good = synth.synthesize('Boa.');
    await expect(bad).rejects.toThrow('não falou: Ruim.');
    expect((await good)?.samples.length).toBe(400);
  });

  it('erro de frase cancelada não rejeita', async () => {
    const tts = new FakeTts();
    tts.auto = false;
    tts.failOn.add('Ruim.');
    const synth = new Synthesizer(tts, voice);
    const bad = synth.synthesize('Ruim.');
    await tick();
    synth.cancel();
    tts.release();
    await expect(bad).resolves.toBeUndefined();
  });
});

describe('toPhonemeCodepoints', () => {
  it('separa o til da vogal (NFD) e descarta frases vazias', () => {
    expect(toPhonemeCodepoints(['bẽ', '  ', 'õ'])).toEqual([
      [0x62, 0x65, 0x303],
      [0x6f, 0x303],
    ]);
  });
});

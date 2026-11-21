import { describe, expect, it } from 'vitest';
import type { PlayedEvent, PlayRequest } from '../shared/voice.js';
import { micErrorMessage, MicResampler, PlaybackQueue, rmsLevel } from './voice-audio.js';

function concat(chunks: Float32Array[]): number[] {
  return chunks.flatMap((c) => Array.from(c));
}

/** Entrega `total` amostras em blocos de 128, como o AudioWorklet. */
function feed(r: MicResampler, signal: (i: number) => number, total: number): Float32Array[] {
  const out: Float32Array[] = [];
  for (let start = 0; start < total; start += 128) {
    const block = new Float32Array(Math.min(128, total - start));
    for (let i = 0; i < block.length; i++) block[i] = signal(start + i);
    out.push(...r.push(block));
  }
  return out;
}

describe('MicResampler', () => {
  it('48 kHz → 16 kHz: média de cada 3 amostras, em pedaços de 512', () => {
    const r = new MicResampler(48_000, 16_000, 512);
    const chunks = feed(r, (i) => i % 3, 48_000);
    // 48000 amostras → 16000 de saída → 31 pedaços completos (15872) e o resto guardado.
    expect(chunks).toHaveLength(31);
    for (const c of chunks) expect(c).toHaveLength(512);
    for (const v of concat(chunks)) expect(v).toBeCloseTo(1, 6);
  });

  it('44,1 kHz → 16 kHz mantém a duração (razão fracionária)', () => {
    const r = new MicResampler(44_100, 16_000, 512);
    const chunks = feed(r, () => 0.5, 44_100 * 2);
    const produced = chunks.length * 512;
    expect(32_000 - produced).toBeGreaterThanOrEqual(0);
    expect(32_000 - produced).toBeLessThan(512);
    for (const v of concat(chunks)) expect(v).toBeCloseTo(0.5, 6);
  });

  it('o resultado não depende do tamanho dos blocos de entrada', () => {
    const signal = (i: number) => Math.sin(i / 7);
    const a = new MicResampler(48_000, 16_000, 512);
    const byBlocks = feed(a, signal, 9_600);
    const b = new MicResampler(48_000, 16_000, 512);
    const whole = new Float32Array(9_600).map((_, i) => signal(i));
    const atOnce = b.push(whole);
    expect(concat(byBlocks)).toEqual(concat(atOnce));
  });

  it('atenua frequências acima de 8 kHz (sem serrilhado forte)', () => {
    // 24 kHz em 48 kHz: +1, -1, +1, ... a média de 3 fica em ±1/3, não ±1.
    const r = new MicResampler(48_000, 16_000, 512);
    const out = concat(feed(r, (i) => (i % 2 === 0 ? 1 : -1), 4_800));
    for (const v of out) expect(Math.abs(v)).toBeLessThanOrEqual(1 / 3 + 1e-6);
  });

  it('sobe a taxa repetindo amostras quando a entrada é mais lenta', () => {
    const r = new MicResampler(8_000, 16_000, 4);
    const out = concat(r.push(new Float32Array([0.1, 0.2, 0.3, 0.4])));
    expect(out).toHaveLength(8);
    expect(out[0]).toBeCloseTo(0.1);
    expect(out[1]).toBeCloseTo(0.1);
    expect(out[7]).toBeCloseTo(0.4);
  });

  it('cada pedaço é um array novo (pode ser transferido sem estragar o próximo)', () => {
    const r = new MicResampler(16_000, 16_000, 2);
    const [a, b] = r.push(new Float32Array([1, 2, 3, 4]));
    expect(a).not.toBe(b);
    expect(Array.from(a ?? [])).toEqual([1, 2]);
    expect(Array.from(b ?? [])).toEqual([3, 4]);
  });

  it('recusa parâmetros inválidos', () => {
    expect(() => new MicResampler(0, 16_000, 512)).toThrow();
    expect(() => new MicResampler(48_000, 16_000, 0)).toThrow();
  });
});

describe('rmsLevel', () => {
  it('silêncio é 0 e vazio é 0', () => {
    expect(rmsLevel(new Float32Array(256))).toBe(0);
    expect(rmsLevel(new Float32Array(0))).toBe(0);
  });

  it('aplica o ganho e limita a 1', () => {
    expect(rmsLevel(new Float32Array(100).fill(0.1), 5)).toBeCloseTo(0.5);
    expect(rmsLevel(new Float32Array(100).fill(0.9), 5)).toBe(1);
    expect(rmsLevel(new Float32Array(100).fill(-0.1), 2)).toBeCloseTo(0.2);
  });

  it('valor inválido vira 0', () => {
    expect(rmsLevel(new Float32Array([NaN, 0.5]))).toBe(0);
  });
});

describe('micErrorMessage', () => {
  it('diferencia permissão, aparelho ausente e outros erros', () => {
    expect(micErrorMessage('NotAllowedError')).toMatch(/permissão/);
    expect(micErrorMessage('NotFoundError')).toMatch(/Nenhum microfone/);
    expect(micErrorMessage('NotReadableError')).toMatch(/outro programa/);
    expect(micErrorMessage(undefined)).toBe('Não consegui abrir o microfone.');
  });
});

describe('PlaybackQueue', () => {
  function setup() {
    const events: PlayedEvent[] = [];
    const playing: { req: PlayRequest; end: () => void; stopped: boolean }[] = [];
    let idle = 0;
    const q = new PlaybackQueue(
      (req, onEnded) => {
        const entry = { req, end: onEnded, stopped: false };
        playing.push(entry);
        return () => {
          entry.stopped = true;
          // WebAudio também dispara onended depois de stop(): a fila deve ignorar.
          onEnded();
        };
      },
      (e) => events.push(e),
      () => idle++,
    );
    const req = (id: string): PlayRequest => ({
      id,
      samples: new Float32Array(10),
      sampleRate: 24_000,
    });
    return { q, events, playing, req, idle: () => idle };
  }

  it('toca em sequência e avisa início e fim de cada um', () => {
    const { q, events, playing, req, idle } = setup();
    q.enqueue(req('a'));
    q.enqueue(req('b'));
    expect(playing).toHaveLength(1);
    playing[0]?.end();
    expect(playing).toHaveLength(2);
    playing[1]?.end();
    playing[1]?.end(); // fim duplicado não gera outro evento
    expect(events).toEqual([
      { id: 'a', state: 'start' },
      { id: 'a', state: 'end' },
      { id: 'b', state: 'start' },
      { id: 'b', state: 'end' },
    ]);
    expect(q.playing).toBe(false);
    expect(idle()).toBe(1);
  });

  it('stop interrompe o atual, manda o fim dele e descarta a fila', () => {
    const { q, events, playing, req, idle } = setup();
    q.enqueue(req('a'));
    q.enqueue(req('b'));
    q.stop();
    expect(playing[0]?.stopped).toBe(true);
    expect(playing).toHaveLength(1);
    expect(events).toEqual([
      { id: 'a', state: 'start' },
      { id: 'a', state: 'end' },
    ]);
    expect(idle()).toBe(1);
    q.stop(); // parado: nada acontece
    expect(events).toHaveLength(2);
    // Depois de parar, a fila volta a funcionar.
    q.enqueue(req('c'));
    expect(events.at(-1)).toEqual({ id: 'c', state: 'start' });
  });

  it('áudio que falha ao começar conta como tocado e a fila segue', () => {
    const events: PlayedEvent[] = [];
    const q = new PlaybackQueue(
      (req) => {
        if (req.id === 'ruim') throw new Error('taxa inválida');
        return () => {};
      },
      (e) => events.push(e),
    );
    q.enqueue({ id: 'ruim', samples: new Float32Array(0), sampleRate: 0 });
    q.enqueue({ id: 'bom', samples: new Float32Array(1), sampleRate: 24_000 });
    expect(events).toEqual([
      { id: 'ruim', state: 'start' },
      { id: 'ruim', state: 'end' },
      { id: 'bom', state: 'start' },
    ]);
  });
});

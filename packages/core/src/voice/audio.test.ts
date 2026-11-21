import { describe, expect, it } from 'vitest';
import { chunks, durationOf, parseWav, resampleLinear } from './audio.js';

/** Monta um WAV PCM 16 bits na memória. */
function wav(
  values: number[],
  { sampleRate = 16000, channels = 1, bits = 16, tag = 1, extra = [] as Uint8Array[] } = {},
): Uint8Array {
  const dataSize = values.length * 2;
  const extraSize = extra.reduce((n, e) => n + e.length, 0);
  const buf = new ArrayBuffer(12 + 24 + extraSize + 8 + dataSize);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  const text = (offset: number, s: string) => {
    for (let i = 0; i < 4; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, buf.byteLength - 8, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, tag, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, bits, true);
  let offset = 36;
  for (const e of extra) {
    bytes.set(e, offset);
    offset += e.length;
  }
  text(offset, 'data');
  view.setUint32(offset + 4, dataSize, true);
  values.forEach((v, i) => view.setInt16(offset + 8 + i * 2, v, true));
  return bytes;
}

/** Bloco extra (ex.: LIST) de tamanho ímpar, com o byte de preenchimento. */
function chunk(id: string, size: number): Uint8Array {
  const out = new Uint8Array(8 + size + (size % 2));
  for (let i = 0; i < 4; i++) out[i] = id.charCodeAt(i);
  new DataView(out.buffer).setUint32(4, size, true);
  return out;
}

describe('parseWav', () => {
  it('lê PCM 16 bits mono', () => {
    const clip = parseWav(wav([0, 16384, -32768, 32767], { sampleRate: 22050 }));
    expect(clip.sampleRate).toBe(22050);
    expect(Array.from(clip.samples)).toEqual([0, 0.5, -1, 32767 / 32768]);
  });

  it('pula blocos desconhecidos, inclusive de tamanho ímpar', () => {
    const clip = parseWav(wav([100, 200], { extra: [chunk('LIST', 5)] }));
    expect(clip.samples.length).toBe(2);
    expect(clip.samples[1]).toBeCloseTo(200 / 32768);
  });

  it('estéreo vira mono pela média', () => {
    const clip = parseWav(wav([16384, 0, -16384, -16384], { channels: 2 }));
    expect(Array.from(clip.samples)).toEqual([0.25, -0.5]);
  });

  it('funciona com Uint8Array que é pedaço de um buffer maior', () => {
    const inner = wav([16384]);
    const outer = new Uint8Array(inner.length + 10);
    outer.set(inner, 10);
    expect(Array.from(parseWav(outer.subarray(10)).samples)).toEqual([0.5]);
  });

  it('recusa o que não é WAV PCM 16 bits', () => {
    expect(() => parseWav(new Uint8Array([1, 2, 3]))).toThrow(/WAV inválido/);
    expect(() => parseWav(wav([0], { tag: 3 }))).toThrow(/não suportado/);
    expect(() => parseWav(wav([0], { bits: 8 }))).toThrow(/não suportado/);
    const noData = wav([]).subarray(0, 36);
    expect(() => parseWav(noData)).toThrow(/data não encontrado/);
  });
});

describe('resampleLinear', () => {
  it('mesma taxa devolve a entrada', () => {
    const s = new Float32Array([1, 2, 3]);
    expect(resampleLinear(s, 16000, 16000)).toBe(s);
  });

  it('dobrar a taxa interpola entre as amostras', () => {
    const out = resampleLinear(new Float32Array([0, 1, 0]), 8000, 16000);
    expect(out.length).toBe(6);
    expect(Array.from(out)).toEqual([0, 0.5, 1, 0.5, 0, 0]);
  });

  it('22050 → 16000 mantém a duração e o formato da onda', () => {
    const from = 22050;
    const input = new Float32Array(from).map((_, i) => Math.sin((2 * Math.PI * 200 * i) / from));
    const out = resampleLinear(input, from, 16000);
    expect(out.length).toBe(16000);
    for (let i = 0; i < out.length; i += 997) {
      expect(out[i]).toBeCloseTo(Math.sin((2 * Math.PI * 200 * i) / 16000), 1);
    }
  });

  it('recusa taxa zero ou negativa', () => {
    expect(() => resampleLinear(new Float32Array(1), 0, 16000)).toThrow(RangeError);
  });
});

describe('chunks e durationOf', () => {
  it('divide sem perder amostras', () => {
    const s = new Float32Array(1100).map((_, i) => i);
    const parts = [...chunks(s, 512)];
    expect(parts.map((p) => p.length)).toEqual([512, 512, 76]);
    expect(parts[2]?.[0]).toBe(1024);
    expect(() => [...chunks(s, 0)]).toThrow(RangeError);
  });

  it('duração em segundos', () => {
    expect(durationOf({ samples: new Float32Array(24000), sampleRate: 16000 })).toBe(1.5);
  });
});

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { VoiceModelError } from './config.js';
import { Synthesizer } from './engine.js';
import {
  createSupertonicTts,
  numberToWords,
  resolveSupertonicConfig,
  SUPERTONIC_PRESET,
  SUPERTONIC_VOICES,
  supertonicConfigSchema,
  supertonicSherpaConfig,
  supertonicText,
  trimSilence,
  type SupertonicSherpa,
  type SupertonicSherpaConfig,
} from './supertonic.js';

/** Sherpa falsa: guarda a configuração e os pedidos; cada pedido gera 1 amostra por letra. */
function fakeSherpa(numSpeakers = 10) {
  const configs: SupertonicSherpaConfig[] = [];
  const requests: { text: string; sid: number; speed: number; numSteps: number; lang: string }[] =
    [];
  const sherpa: SupertonicSherpa = {
    OfflineTts: {
      createAsync(config) {
        configs.push(config);
        return Promise.resolve({
          sampleRate: 44_100,
          numSpeakers,
          generateAsync(req) {
            requests.push({
              text: req.text,
              sid: req.generationConfig.sid,
              speed: req.generationConfig.speed,
              numSteps: req.generationConfig.numSteps,
              lang: req.generationConfig.extra.lang,
            });
            expect(req.enableExternalBuffer).toBe(false);
            return Promise.resolve({
              samples: new Float32Array(req.text.length).fill(0.1),
              sampleRate: 44_100,
            });
          },
        });
      },
    },
  };
  return { sherpa, configs, requests };
}

const config = supertonicConfigSchema.parse({ ...SUPERTONIC_PRESET, numSteps: 4 });

describe('numberToWords', () => {
  it.each([
    [0, 'zero'],
    [1, 'um'],
    [3, 'três'],
    [16, 'dezesseis'],
    [21, 'vinte e um'],
    [40, 'quarenta'],
    [100, 'cem'],
    [101, 'cento e um'],
    [345, 'trezentos e quarenta e cinco'],
    [1000, 'mil'],
    [1500, 'mil e quinhentos'],
    [1230, 'mil duzentos e trinta'],
    [2026, 'dois mil e vinte e seis'],
    [21_000, 'vinte e um mil'],
  ])('%i → %s', (n, words) => {
    expect(numberToWords(n)).toBe(words);
  });

  it('fora do alcance devolve os dígitos', () => {
    expect(numberToWords(1_000_000)).toBe('1000000');
  });
});

describe('supertonicText', () => {
  it('escreve números por extenso', () => {
    expect(supertonicText('São 3 horas e 40 minutos.')).toBe('São três horas e quarenta minutos.');
    expect(supertonicText('Faltam 3h40, depois 1h00 e 22h05.')).toBe(
      'Faltam três horas e quarenta, depois uma hora e vinte e duas horas e cinco.',
    );
    expect(supertonicText('Custa 1.500 reais, 10% a menos.')).toBe(
      'Custa mil e quinhentos reais, dez por cento a menos.',
    );
    expect(supertonicText('Tem 2,5 litros.')).toBe('Tem dois vírgula cinco litros.');
  });

  it('não mexe no resto', () => {
    expect(supertonicText('Oi!  Que bom que você voltou.')).toBe('Oi! Que bom que você voltou.');
  });
});

describe('trimSilence', () => {
  const rate = 1000; // janelas de 10 amostras

  it('corta os zeros das pontas e deixa a folga', () => {
    const samples = new Float32Array(1000);
    samples.fill(0.3, 500, 700); // fala de 500 a 700
    const out = trimSilence(samples, rate, { leadMs: 20, tailMs: 60 });
    expect(out.length).toBe(200 + 20 + 60);
    expect(out[19]).toBe(0);
    expect(out[20]).toBeCloseTo(0.3);
    // cópia, não uma view do buffer original
    expect(out.buffer).not.toBe(samples.buffer);
  });

  it('mantém o silêncio do meio (pausas na vírgula)', () => {
    const samples = new Float32Array(1000);
    samples.fill(0.3, 100, 200);
    samples.fill(0.3, 600, 700);
    const out = trimSilence(samples, rate, { leadMs: 0, tailMs: 0 });
    expect(out.length).toBe(600);
  });

  it('só silêncio vira áudio vazio', () => {
    expect(trimSilence(new Float32Array(500), rate).length).toBe(0);
  });

  it('não corta som baixo acima do limiar', () => {
    const samples = new Float32Array(100).fill(0.001);
    expect(trimSilence(samples, rate, { leadMs: 0, tailMs: 0 }).length).toBe(100);
  });
});

describe('createSupertonicTts', () => {
  it('passa os arquivos, os passos e o idioma para a sherpa', async () => {
    const { sherpa, configs, requests } = fakeSherpa();
    const tts = await createSupertonicTts(config, sherpa);
    expect(tts.sampleRate).toBe(44_100);
    expect(configs[0]).toEqual(supertonicSherpaConfig(config));
    expect(configs[0]?.model.supertonic.voiceStyle).toBe(SUPERTONIC_PRESET.voiceStyle);
    expect(configs[0]?.model.numThreads).toBe(2);

    const audio = await tts.generate('Oi, Leo!', { sid: SUPERTONIC_VOICES.M1, speed: 1.1 });
    expect(audio.sampleRate).toBe(44_100);
    expect(audio.samples.length).toBe('Oi, Leo!'.length);
    expect(requests).toEqual([{ text: 'Oi, Leo!', sid: 5, speed: 1.1, numSteps: 4, lang: 'pt' }]);
  });

  it('manda os números por extenso', async () => {
    const { sherpa, requests } = fakeSherpa();
    const tts = await createSupertonicTts(config, sherpa);
    await tts.generate('São 3 horas.', { sid: 0, speed: 1 });
    expect(requests[0]?.text).toBe('São três horas.');
  });

  it('recusa voz que não existe', async () => {
    const { sherpa, requests } = fakeSherpa(10);
    const tts = await createSupertonicTts(config, sherpa);
    await expect(tts.generate('Oi.', { sid: 10, speed: 1 })).rejects.toBeInstanceOf(
      VoiceModelError,
    );
    await expect(tts.generate('Oi.', { sid: -1, speed: 1 })).rejects.toBeInstanceOf(
      VoiceModelError,
    );
    expect(requests).toHaveLength(0);
  });

  it('sem letras nem números, devolve áudio vazio sem chamar o modelo', async () => {
    const { sherpa, requests } = fakeSherpa();
    const tts = await createSupertonicTts(config, sherpa);
    const audio = await tts.generate('...', { sid: 0, speed: 1 });
    expect(audio.samples.length).toBe(0);
    expect(requests).toHaveLength(0);
  });

  it('funciona atrás do Synthesizer (fila e voz padrão)', async () => {
    const { sherpa, requests } = fakeSherpa();
    const tts = await createSupertonicTts(config, sherpa);
    const synth = new Synthesizer(tts, { sid: SUPERTONIC_VOICES.F2, speed: 1 });
    const [a, b] = await Promise.all([
      synth.synthesize('Primeira frase.'),
      synth.synthesize('Segunda frase.', { speed: 0.9 }),
    ]);
    expect(a?.samples.length).toBeGreaterThan(0);
    expect(b?.samples.length).toBeGreaterThan(0);
    expect(requests.map((r) => [r.sid, r.speed])).toEqual([
      [1, 1],
      [1, 0.9],
    ]);
  });
});

describe('resolveSupertonicConfig', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('resolve os caminhos e confere os arquivos', () => {
    dir = mkdtempSync(join(tmpdir(), 'stella-supertonic-'));
    const files = {
      durationPredictor: 'dp.onnx',
      textEncoder: 'te.onnx',
      vectorEstimator: 've.onnx',
      vocoder: 'voc.onnx',
      ttsJson: 'tts.json',
      unicodeIndexer: 'ui.bin',
      voiceStyle: 'voice.bin',
    };
    for (const f of Object.values(files)) writeFileSync(join(dir, f), '');
    const resolved = resolveSupertonicConfig(files, dir);
    expect(resolved.vocoder).toBe(join(dir, 'voc.onnx'));
    expect(resolved.lang).toBe('pt');
    expect(resolved.numSteps).toBe(5);
  });

  it('lista o que falta', () => {
    dir = mkdtempSync(join(tmpdir(), 'stella-supertonic-'));
    try {
      resolveSupertonicConfig(SUPERTONIC_PRESET, dir);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(VoiceModelError);
      expect((error as VoiceModelError).missing).toHaveLength(7);
    }
  });

  it('recusa configuração inválida', () => {
    expect(() => resolveSupertonicConfig({ ...SUPERTONIC_PRESET, numSteps: 0 }, '.')).toThrow(
      VoiceModelError,
    );
  });
});

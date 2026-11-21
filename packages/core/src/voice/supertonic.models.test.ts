import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { durationOf, resampleLinear } from './audio.js';
import { VOICE_PRESETS } from './config.js';
import type { RecognizerBackend, TtsBackend } from './engine.js';
import { createSherpaRecognizer, VOICE_SAMPLE_RATE } from './sherpa.js';
import {
  createSupertonicTts,
  resolveSupertonicConfig,
  SUPERTONIC_PRESET,
  SUPERTONIC_VOICES,
} from './supertonic.js';

/**
 * Supertonic 3 com o modelo de verdade. Só roda se os arquivos existirem: em models/voz
 * (quando entrar no models:pull) ou em models/voz/_tts2 (avaliação). A ida e volta pelo
 * Parakeet só roda se ele também estiver em models/voz.
 */
const here = dirname(fileURLToPath(import.meta.url));
const VOZ = resolve(here, '../../../../models/voz');
const DIRS = [process.env.STELLA_SUPERTONIC_DIR, VOZ, join(VOZ, '_tts2')].filter(
  (d): d is string => d !== undefined,
);
const hasAll = (dir: string) =>
  Object.values(SUPERTONIC_PRESET).every((p) => existsSync(join(dir, p)));
const DIR = DIRS.find(hasAll);
const hasParakeet = existsSync(join(VOZ, VOICE_PRESETS.asr.parakeet.encoder));
const TIMEOUT = 180_000;

describe.skipIf(DIR === undefined)('Supertonic 3 com o modelo real', () => {
  let tts: TtsBackend;

  beforeAll(async () => {
    tts = await createSupertonicTts(resolveSupertonicConfig(SUPERTONIC_PRESET, DIR ?? '.'));
  }, TIMEOUT);

  it(
    'fala pt-BR a 44,1 kHz com cada voz',
    async () => {
      expect(tts.sampleRate).toBe(44_100);
      for (const sid of [SUPERTONIC_VOICES.M1, SUPERTONIC_VOICES.F2]) {
        const audio = await tts.generate('Olá, eu sou a Stella.', { sid, speed: 1 });
        expect(audio.sampleRate).toBe(44_100);
        const seconds = durationOf(audio);
        expect(seconds).toBeGreaterThan(0.6);
        expect(seconds).toBeLessThan(5);
        const peak = audio.samples.reduce((m, s) => Math.max(m, Math.abs(s)), 0);
        expect(peak).toBeGreaterThan(0.05);
        expect(peak).toBeLessThanOrEqual(1.5);
      }
    },
    TIMEOUT,
  );

  it(
    'speed muda a duração',
    async () => {
      const text = 'Hoje é dia de fazer acontecer.';
      const normal = await tts.generate(text, { sid: SUPERTONIC_VOICES.F1, speed: 1 });
      const fast = await tts.generate(text, { sid: SUPERTONIC_VOICES.F1, speed: 1.3 });
      expect(durationOf(fast)).toBeLessThan(durationOf(normal) * 0.9);
    },
    TIMEOUT,
  );

  describe.skipIf(!hasParakeet)('ida e volta pelo Parakeet', () => {
    let recognizer: RecognizerBackend;

    beforeAll(async () => {
      const p = VOICE_PRESETS.asr.parakeet;
      recognizer = await createSherpaRecognizer({
        asr: {
          kind: p.kind,
          encoder: join(VOZ, p.encoder),
          decoder: join(VOZ, p.decoder),
          joiner: join(VOZ, p.joiner),
          tokens: join(VOZ, p.tokens),
        },
        numThreads: 2,
      });
    }, TIMEOUT);

    it(
      'o reconhecimento entende a frase (números por extenso)',
      async () => {
        const audio = await tts.generate('A Pixi disse que são 3 horas e 40 minutos.', {
          sid: SUPERTONIC_VOICES.F3,
          speed: 1,
        });
        const samples = resampleLinear(audio.samples, audio.sampleRate, VOICE_SAMPLE_RATE);
        const text = (await recognizer.transcribe(samples, VOICE_SAMPLE_RATE)).toLowerCase();
        expect(text).toMatch(/horas/);
        expect(text).toMatch(/quarenta|40/);
        expect(text).toMatch(/minutos/);
      },
      TIMEOUT,
    );
  });
});

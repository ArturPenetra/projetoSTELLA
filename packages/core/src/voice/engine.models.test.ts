import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { chunks, durationOf, parseWav, resampleLinear } from './audio.js';
import {
  resolveVoiceModels,
  VOICE_PRESETS,
  VoiceModelError,
  type VoiceConfigInput,
} from './config.js';
import { Listener, Synthesizer } from './engine.js';
import {
  createSherpaRecognizer,
  createSherpaTts,
  createSherpaVad,
  createVoiceEngine,
  VOICE_SAMPLE_RATE,
  type Phonemizer,
  type VoiceEngine,
} from './sherpa.js';

/**
 * Testes com os modelos de verdade. Só rodam se as pastas existirem: em outras máquinas e no
 * CI, ficam de fora. MODELS: os modelos do app (npm run models:pull, em models/voz).
 * CANDIDATES: os avaliados na Fase 7 e o áudio de teste pt_br.wav (models/voz/_baixando).
 */
const here = dirname(fileURLToPath(import.meta.url));
const MODELS = process.env.STELLA_VOICE_MODELS ?? resolve(here, '../../../../models/voz');
const CANDIDATES =
  process.env.STELLA_VOICE_CANDIDATES ?? resolve(here, '../../../../models/voz/_baixando');
const hasIn = (dir: string, ...paths: string[]) => paths.every((p) => existsSync(join(dir, p)));
const has = (...paths: string[]) => hasIn(MODELS, ...paths);
const hasCandidates = (...paths: string[]) => hasIn(CANDIDATES, ...paths);
const folderOf = (file: string) => file.split('/')[0] ?? file;

const WAV = 'pt_br.wav';
const TIMEOUT = 180_000;

/**
 * Fonetizador fixo para o teste: a sherpa-onnx 2.x não traz o espeak-ng, e o app ainda
 * não tem fonetizador. IPA no estilo do espeak-ng (pt-br).
 */
const SENTENCE = 'Olá, eu sou a Stella.';
const fixedPhonemizer: Phonemizer = (text) => {
  if (text !== SENTENCE) throw new Error(`Fonetizador de teste não conhece: ${text}`);
  return ['olˈa, ˈew sˈow a stˈɛla.'];
};

function micAudio(): Float32Array {
  const clip = parseWav(readFileSync(join(CANDIDATES, WAV)));
  return resampleLinear(clip.samples, clip.sampleRate, VOICE_SAMPLE_RATE);
}

/** Passa o arquivo pelo ouvinte em pedaços de 512, como o microfone faria. */
async function listen(listener: Listener): Promise<{ text: string; starts: number }> {
  const texts: string[] = [];
  let starts = 0;
  const offText = listener.on('text', (t) => texts.push(t));
  const offStart = listener.on('speech-start', () => starts++);
  for (const chunk of chunks(micAudio(), 512)) listener.feed(chunk);
  listener.flush();
  await listener.idle();
  offText();
  offStart();
  return { text: texts.join(' '), starts };
}

function expectPortuguese(text: string): void {
  const lower = text.toLowerCase();
  expect(lower).toContain('pergunte');
  expect(lower).toMatch(/pa[ií]s/);
}

async function expectSpeech(synth: Synthesizer, sampleRate: number): Promise<void> {
  const audio = await synth.synthesize(SENTENCE);
  expect(audio).toBeDefined();
  if (!audio) return;
  expect(audio.sampleRate).toBe(sampleRate);
  const seconds = durationOf(audio);
  expect(seconds).toBeGreaterThan(0.6);
  expect(seconds).toBeLessThan(5);
  const peak = audio.samples.reduce((m, s) => Math.max(m, Math.abs(s)), 0);
  expect(peak).toBeGreaterThan(0.05);
  expect(peak).toBeLessThanOrEqual(1.5);
}

const parakeetKokoro: VoiceConfigInput = {
  vad: VOICE_PRESETS.vad,
  asr: VOICE_PRESETS.asr.parakeet,
  tts: VOICE_PRESETS.tts.kokoro,
};

describe.skipIf(
  !hasCandidates(WAV) ||
    !has(VOICE_PRESETS.vad.model, folderOf(VOICE_PRESETS.asr.parakeet.encoder)) ||
    !has(folderOf(VOICE_PRESETS.tts.kokoro.model)),
)('voz com modelos reais: Parakeet + Kokoro (createVoiceEngine)', () => {
  let engine: VoiceEngine;

  beforeAll(async () => {
    engine = await createVoiceEngine({
      config: parakeetKokoro,
      modelsDir: MODELS,
      phonemizer: fixedPhonemizer,
    });
  }, TIMEOUT);

  it(
    'transcreve o pt_br.wav em português',
    async () => {
      const { text, starts } = await listen(engine.listener);
      expect(starts).toBeGreaterThan(0);
      expectPortuguese(text);
    },
    TIMEOUT,
  );

  it(
    'Kokoro fala pt-BR (pf_dora) a 24 kHz',
    async () => {
      expect(engine.models.tts.sid).toBe(42);
      await expectSpeech(engine.synthesizer, 24000);
    },
    TIMEOUT,
  );

  it('sem léxico nem fonetizador, a síntese recusa com mensagem clara', async () => {
    await expect(createVoiceEngine({ config: parakeetKokoro, modelsDir: MODELS })).rejects.toThrow(
      /precisa de um léxico ou de um fonetizador/,
    );
  });
});

describe.skipIf(
  !hasCandidates(
    VOICE_PRESETS.vad.model,
    WAV,
    folderOf(VOICE_PRESETS.asr.whisperSmall.encoder),
    folderOf(VOICE_PRESETS.tts.piperDii.model),
  ),
)('voz com modelos reais: Whisper small', () => {
  let listener: Listener;

  beforeAll(async () => {
    const models = resolveVoiceModels(
      { ...parakeetKokoro, asr: VOICE_PRESETS.asr.whisperSmall, tts: VOICE_PRESETS.tts.piperDii },
      CANDIDATES,
    );
    listener = new Listener(createSherpaVad(models.vad), await createSherpaRecognizer(models));
  }, TIMEOUT);

  it(
    'transcreve o pt_br.wav em português',
    async () => {
      expectPortuguese((await listen(listener)).text);
    },
    TIMEOUT,
  );
});

for (const [name, preset] of [
  ['Piper dii', VOICE_PRESETS.tts.piperDii],
  ['Piper miro', VOICE_PRESETS.tts.piperMiro],
] as const) {
  describe.skipIf(
    !hasCandidates(
      VOICE_PRESETS.vad.model,
      folderOf(preset.model),
      folderOf(VOICE_PRESETS.asr.parakeet.encoder),
    ),
  )(`voz com modelos reais: ${name}`, () => {
    it(
      'fala pt-BR a 22 kHz',
      async () => {
        const models = resolveVoiceModels({ ...parakeetKokoro, tts: preset }, CANDIDATES);
        const tts = await createSherpaTts(models, { phonemizer: fixedPhonemizer });
        await expectSpeech(new Synthesizer(tts, { sid: 0, speed: 1 }), 22050);
      },
      TIMEOUT,
    );

    it(
      'voz inexistente é recusada',
      async () => {
        const models = resolveVoiceModels({ ...parakeetKokoro, tts: preset }, CANDIDATES);
        const tts = await createSherpaTts(models, { phonemizer: fixedPhonemizer });
        await expect(tts.generate(SENTENCE, { sid: 5, speed: 1 })).rejects.toThrow(VoiceModelError);
      },
      TIMEOUT,
    );
  });
}

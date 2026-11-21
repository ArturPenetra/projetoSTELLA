import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { VoiceModelError } from './config.js';
import type { SynthesizedAudio, TtsBackend, Voice } from './engine.js';
import { loadSherpa } from './sherpa.js';

/**
 * Síntese com o Supertonic 3 (Supertone, OpenRAIL-M) pela própria `sherpa-onnx-node`.
 * Diferente do Kokoro e do Piper, ele lê o texto direto (letras Unicode), sem espeak-ng:
 * não há fonetizador, só o código do idioma (`pt`). Avaliação em docs/voz-tts-candidatos.md.
 *
 * Protótipo: ainda não está ligado ao app nem ao `config.ts`.
 */

const modelFile = z.string().trim().min(1);

export const supertonicConfigSchema = z.object({
  durationPredictor: modelFile,
  textEncoder: modelFile,
  vectorEstimator: modelFile,
  vocoder: modelFile,
  ttsJson: modelFile,
  /** `unicode_indexer.bin` e `voice.bin` são os do pacote da sherpa (não os .json originais). */
  unicodeIndexer: modelFile,
  voiceStyle: modelFile,
  /** Código ISO 639-1 que o modelo conhece (`pt` cobre o português do Brasil). */
  lang: z.string().trim().min(2).max(3).default('pt'),
  /**
   * Passos do fluxo (vector estimator). Cada passo custa o mesmo tempo; menos passos = mais
   * rápido e um pouco mais áspero. 5 equilibra os dois no i5-4440.
   */
  numSteps: z.number().int().min(1).max(32).default(5),
  numThreads: z.number().int().min(1).max(8).default(2),
});

export type SupertonicConfig = z.infer<typeof supertonicConfigSchema>;
export type SupertonicConfigInput = z.input<typeof supertonicConfigSchema>;

/**
 * Pasta do pacote da sherpa (`sherpa-onnx-supertonic-3-tts-int8-2026-05-11`). O vector
 * estimator e o vocoder em fp32 (do Hugging Face) são mais rápidos nesta CPU que os int8;
 * os dois primeiros modelos do pacote "int8" já são fp32 (mesmo SHA-256).
 */
export const SUPERTONIC_PRESET = {
  durationPredictor: 'sherpa-onnx-supertonic-3-tts-int8-2026-05-11/duration_predictor.int8.onnx',
  textEncoder: 'sherpa-onnx-supertonic-3-tts-int8-2026-05-11/text_encoder.int8.onnx',
  vectorEstimator: 'supertonic-3/onnx/vector_estimator.onnx',
  vocoder: 'supertonic-3/onnx/vocoder.onnx',
  ttsJson: 'sherpa-onnx-supertonic-3-tts-int8-2026-05-11/tts.json',
  unicodeIndexer: 'sherpa-onnx-supertonic-3-tts-int8-2026-05-11/unicode_indexer.bin',
  voiceStyle: 'sherpa-onnx-supertonic-3-tts-int8-2026-05-11/voice.bin',
} as const satisfies SupertonicConfigInput;

/** Estilos de voz do `voice.bin` (conferido contra os voice_styles/*.json originais). */
export const SUPERTONIC_VOICES = {
  F1: 0,
  F2: 1,
  F3: 2,
  F4: 3,
  F5: 4,
  M1: 5,
  M2: 6,
  M3: 7,
  M4: 8,
  M5: 9,
} as const;

export type SupertonicVoiceName = keyof typeof SUPERTONIC_VOICES;

const FILE_KEYS = [
  'durationPredictor',
  'textEncoder',
  'vectorEstimator',
  'vocoder',
  'ttsJson',
  'unicodeIndexer',
  'voiceStyle',
] as const;

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** Valida e troca os caminhos por absolutos (relativos a `modelsDir`). Lança `VoiceModelError`. */
export function resolveSupertonicConfig(raw: unknown, modelsDir: string): SupertonicConfig {
  const parsed = supertonicConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(raiz)'}: ${issue.message}`)
      .join('; ');
    throw new VoiceModelError(`Configuração do Supertonic inválida: ${issues}`);
  }
  const config = { ...parsed.data };
  const missing: string[] = [];
  for (const key of FILE_KEYS) {
    const full = resolve(modelsDir, config[key]);
    if (!isFile(full)) missing.push(full);
    config[key] = full;
  }
  if (missing.length > 0) {
    throw new VoiceModelError(`Modelo de voz não encontrado: ${missing.join(', ')}.`, missing);
  }
  return config;
}

// ---------------------------------------------------------------- texto

const UNITS = [
  'zero',
  'um',
  'dois',
  'três',
  'quatro',
  'cinco',
  'seis',
  'sete',
  'oito',
  'nove',
  'dez',
  'onze',
  'doze',
  'treze',
  'catorze',
  'quinze',
  'dezesseis',
  'dezessete',
  'dezoito',
  'dezenove',
];
const TENS = [
  '',
  '',
  'vinte',
  'trinta',
  'quarenta',
  'cinquenta',
  'sessenta',
  'setenta',
  'oitenta',
  'noventa',
];
const HUNDREDS = [
  '',
  'cento',
  'duzentos',
  'trezentos',
  'quatrocentos',
  'quinhentos',
  'seiscentos',
  'setecentos',
  'oitocentos',
  'novecentos',
];

function below1000(n: number): string {
  if (n === 100) return 'cem';
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h > 0) parts.push(HUNDREDS[h] ?? '');
  if (rest > 0) {
    if (rest < 20) parts.push(UNITS[rest] ?? '');
    else {
      const t = Math.floor(rest / 10);
      const u = rest % 10;
      parts.push(u > 0 ? `${TENS[t]} e ${UNITS[u]}` : (TENS[t] ?? ''));
    }
  }
  return parts.join(' e ');
}

/** Número inteiro por extenso (0 a 999.999), no masculino. Acima disso, devolve os dígitos. */
export function numberToWords(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 999_999) return String(n);
  if (n < 1000) return n === 0 ? 'zero' : below1000(n);
  const thousands = Math.floor(n / 1000);
  const rest = n % 1000;
  const head = thousands === 1 ? 'mil' : `${below1000(thousands)} mil`;
  if (rest === 0) return head;
  // "mil e cem", "mil e vinte", mas "mil duzentos e trinta".
  const joiner = rest < 100 || rest % 100 === 0 ? ' e ' : ' ';
  return `${head}${joiner}${below1000(rest)}`;
}

/**
 * Prepara o texto para o Supertonic, que lê letras e não sabe ler números: dígitos viram
 * palavras ("3h40" → "três horas e quarenta", "1.500" → "mil e quinhentos") e "%" vira
 * "por cento". O resto fica como está (o modelo cuida da pontuação e dos acentos).
 */
export function supertonicText(text: string): string {
  return text
    .replace(/\b(\d{1,2})h(\d{2})\b/g, (_, h: string, m: string) => {
      const hours = Number(h);
      const minutes = Number(m);
      // "hora" é feminino: uma hora, duas horas, vinte e uma horas.
      const spoken = numberToWords(hours)
        .replace(/\bum$/, 'uma')
        .replace(/\bdois$/, 'duas');
      const hw = `${spoken} ${hours === 1 ? 'hora' : 'horas'}`;
      return minutes === 0 ? hw : `${hw} e ${numberToWords(minutes)}`;
    })
    .replace(/\b(\d{1,3}(?:\.\d{3})+)\b/g, (m: string) => m.replace(/\./g, ''))
    .replace(/(\d+),(\d+)/g, (_, i: string, d: string) => `${i} vírgula ${d}`)
    .replace(/(\d+)\s*%/g, '$1 por cento')
    .replace(/\d+/g, (m: string) => numberToWords(Number(m)))
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------- silêncio

/**
 * O Supertonic devolve ~0,5 s de zeros no começo e ~0,4 s no fim de cada frase (medido nas
 * 50 amostras). No começo isso atrasa a primeira palavra; entre frases, vira um buraco de
 * ~1 s. Corta janelas de 10 ms com RMS abaixo de `threshold` nas pontas, deixando uma folga.
 */
export function trimSilence(
  samples: Float32Array,
  sampleRate: number,
  { threshold = 2e-4, leadMs = 20, tailMs = 60 } = {},
): Float32Array {
  const win = Math.max(1, Math.round(sampleRate / 100));
  const loud = (start: number): boolean => {
    let e = 0;
    const end = Math.min(samples.length, start + win);
    for (let i = start; i < end; i++) e += (samples[i] ?? 0) ** 2;
    return Math.sqrt(e / Math.max(1, end - start)) >= threshold;
  };
  let first = 0;
  while (first < samples.length && !loud(first)) first += win;
  if (first >= samples.length) return new Float32Array(0);
  let last = Math.floor((samples.length - 1) / win) * win;
  while (last > first && !loud(last)) last -= win;
  const start = Math.max(0, first - Math.round((leadMs * sampleRate) / 1000));
  const end = Math.min(samples.length, last + win + Math.round((tailMs * sampleRate) / 1000));
  // Cópia (slice): uma view levaria o buffer inteiro pelo IPC.
  return samples.slice(start, end);
}

// ---------------------------------------------------------------- sherpa

/** Parte da `sherpa-onnx-node` usada aqui (o `SherpaModule` de sherpa.ts não tem o Supertonic). */
export interface SupertonicSherpaConfig {
  model: {
    supertonic: Pick<SupertonicConfig, (typeof FILE_KEYS)[number]>;
    numThreads: number;
    provider: string;
    debug: boolean | number;
  };
  maxNumSentences: number;
}

interface SupertonicRequest {
  text: string;
  sid: number;
  speed: number;
  enableExternalBuffer: boolean;
  generationConfig: { sid: number; speed: number; numSteps: number; extra: { lang: string } };
}

interface SupertonicNative {
  readonly sampleRate: number;
  readonly numSpeakers: number;
  generateAsync(request: SupertonicRequest): Promise<{ samples: Float32Array; sampleRate: number }>;
}

export interface SupertonicSherpa {
  OfflineTts: { createAsync(config: SupertonicSherpaConfig): Promise<SupertonicNative> };
}

export function supertonicSherpaConfig(config: SupertonicConfig): SupertonicSherpaConfig {
  const supertonic = Object.fromEntries(FILE_KEYS.map((k) => [k, config[k]])) as Pick<
    SupertonicConfig,
    (typeof FILE_KEYS)[number]
  >;
  return {
    model: { supertonic, numThreads: config.numThreads, provider: 'cpu', debug: false },
    maxNumSentences: 1,
  };
}

/**
 * Carrega o Supertonic (`createAsync`) e devolve um `TtsBackend`. `voice.sid` é o estilo
 * (`SUPERTONIC_VOICES`) e `voice.speed` muda o andamento sem mudar a altura (1 = normal).
 * Taxa de saída: 44100 Hz.
 */
export async function createSupertonicTts(
  config: SupertonicConfig,
  sherpa: SupertonicSherpa = loadSherpa() as unknown as SupertonicSherpa,
): Promise<TtsBackend> {
  const native = await sherpa.OfflineTts.createAsync(supertonicSherpaConfig(config));
  return {
    sampleRate: native.sampleRate,
    async generate(text: string, voice: Voice): Promise<SynthesizedAudio> {
      if (!Number.isInteger(voice.sid) || voice.sid < 0 || voice.sid >= native.numSpeakers) {
        throw new VoiceModelError(
          `Voz ${voice.sid} não existe neste modelo (tem ${native.numSpeakers}).`,
        );
      }
      const clean = supertonicText(text);
      if (!/[\p{L}\p{N}]/u.test(clean)) {
        return { samples: new Float32Array(0), sampleRate: native.sampleRate };
      }
      const audio = await native.generateAsync({
        text: clean,
        sid: voice.sid,
        speed: voice.speed,
        enableExternalBuffer: false,
        generationConfig: {
          sid: voice.sid,
          speed: voice.speed,
          numSteps: config.numSteps,
          extra: { lang: config.lang },
        },
      });
      return {
        samples: trimSilence(audio.samples, audio.sampleRate),
        sampleRate: audio.sampleRate,
      };
    },
  };
}

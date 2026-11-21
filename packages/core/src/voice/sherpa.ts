import { createRequire } from 'node:module';
import type { ResolvedVoiceModels, VadConfig } from './config.js';
import { VoiceModelError, resolveVoiceModels } from './config.js';
import {
  Listener,
  Synthesizer,
  type ListenerOptions,
  type RecognizerBackend,
  type SynthesizedAudio,
  type TtsBackend,
  type VadBackend,
  type Voice,
} from './engine.js';

/**
 * Ponte com a `sherpa-onnx-node` (módulo nativo, sem tipos próprios). Só a parte da API
 * que a Stella usa está tipada aqui. O módulo é carregado na primeira chamada: importar
 * `@stella/core` não carrega nada nativo.
 *
 * No Electron, buffers externos não são permitidos: toda chamada que devolve áudio usa
 * `enableExternalBuffer: false` (a sherpa copia as amostras).
 */

interface SherpaWaveform {
  samples: Float32Array;
  sampleRate: number;
}

interface SherpaOfflineStream {
  acceptWaveform(wave: SherpaWaveform): void;
}

interface SherpaRecognizerResult {
  text: string;
  lang?: string;
}

export interface SherpaOfflineRecognizerConfig {
  featConfig?: { sampleRate?: number; featureDim?: number };
  modelConfig: {
    transducer?: { encoder: string; decoder: string; joiner: string };
    whisper?: {
      encoder: string;
      decoder: string;
      language?: string;
      task?: string;
      tailPaddings?: number;
    };
    tokens: string;
    modelType?: string;
    numThreads?: number;
    debug?: boolean | number;
    provider?: string;
  };
}

interface SherpaOfflineRecognizer {
  createStream(): SherpaOfflineStream;
  decodeAsync(stream: SherpaOfflineStream): Promise<SherpaRecognizerResult>;
}

export interface SherpaVadConfig {
  sileroVad: {
    model: string;
    threshold?: number;
    minSilenceDuration?: number;
    minSpeechDuration?: number;
    maxSpeechDuration?: number;
    windowSize?: number;
  };
  sampleRate?: number;
  numThreads?: number;
  provider?: string;
  debug?: boolean | number;
}

interface SherpaVad {
  acceptWaveform(samples: Float32Array): void;
  isEmpty(): boolean;
  isDetected(): boolean;
  front(enableExternalBuffer?: boolean): { start: number; samples: Float32Array };
  pop(): void;
  clear(): void;
  reset(): void;
  flush(): void;
}

export interface SherpaOfflineTtsConfig {
  model: {
    kokoro?: { model: string; voices: string; tokens: string; lexicon?: string };
    vits?: {
      model: string;
      tokens: string;
      lexicon?: string;
      lengthScale?: number;
      noiseScale?: number;
      noiseScaleW?: number;
    };
    numThreads?: number;
    debug?: boolean | number;
    provider?: string;
  };
  maxNumSentences?: number;
}

interface SherpaTtsRequest {
  text: string;
  sid: number;
  speed: number;
  enableExternalBuffer?: boolean;
  generationConfig?: {
    sid?: number;
    speed?: number;
    phonemeCodepoints?: number[][];
  };
}

interface SherpaOfflineTts {
  readonly sampleRate: number;
  readonly numSpeakers: number;
  generateAsync(request: SherpaTtsRequest): Promise<SherpaWaveform>;
}

export interface SherpaModule {
  version: string;
  OfflineRecognizer: {
    createAsync(config: SherpaOfflineRecognizerConfig): Promise<SherpaOfflineRecognizer>;
  };
  Vad: new (config: SherpaVadConfig, bufferSizeInSeconds: number) => SherpaVad;
  OfflineTts: { createAsync(config: SherpaOfflineTtsConfig): Promise<SherpaOfflineTts> };
}

let cached: SherpaModule | undefined;

/** Carrega a `sherpa-onnx-node` (uma vez). */
export function loadSherpa(): SherpaModule {
  if (!cached) {
    const require = createRequire(import.meta.url);
    cached = require('sherpa-onnx-node') as SherpaModule;
  }
  return cached;
}

/** Taxa que o VAD e o reconhecimento esperam. */
export const VOICE_SAMPLE_RATE = 16_000;

// ---------------------------------------------------------------- VAD

export function sherpaVadConfig(vad: VadConfig): SherpaVadConfig {
  return {
    sileroVad: {
      model: vad.model,
      threshold: vad.threshold,
      minSilenceDuration: vad.minSilenceDuration,
      minSpeechDuration: vad.minSpeechDuration,
      maxSpeechDuration: vad.maxSpeechDuration,
      windowSize: vad.windowSize,
    },
    sampleRate: VOICE_SAMPLE_RATE,
    numThreads: 1,
    debug: false,
  };
}

export function createSherpaVad(vad: VadConfig, sherpa = loadSherpa()): VadBackend {
  // O buffer interno guarda a fala mais longa possível, com folga.
  const native = new sherpa.Vad(sherpaVadConfig(vad), Math.ceil(vad.maxSpeechDuration) + 10);
  return {
    acceptWaveform: (samples) => native.acceptWaveform(samples),
    isDetected: () => native.isDetected(),
    popSegments: () => {
      const out: Float32Array[] = [];
      while (!native.isEmpty()) {
        out.push(native.front(false).samples);
        native.pop();
      }
      return out;
    },
    flush: () => native.flush(),
    reset: () => {
      native.clear();
      native.reset();
    },
  };
}

// ---------------------------------------------------------------- reconhecimento

export function sherpaRecognizerConfig(
  models: Pick<ResolvedVoiceModels, 'asr' | 'numThreads'>,
): SherpaOfflineRecognizerConfig {
  const { asr, numThreads } = models;
  const common = { tokens: asr.tokens, numThreads, debug: false, provider: 'cpu' };
  const featConfig = { sampleRate: VOICE_SAMPLE_RATE, featureDim: 80 };
  if (asr.kind === 'nemo_transducer') {
    return {
      featConfig,
      modelConfig: {
        ...common,
        transducer: { encoder: asr.encoder, decoder: asr.decoder, joiner: asr.joiner },
        modelType: 'nemo_transducer',
      },
    };
  }
  return {
    featConfig,
    modelConfig: {
      ...common,
      whisper: {
        encoder: asr.encoder,
        decoder: asr.decoder,
        language: asr.language,
        task: asr.task,
        ...(asr.tailPaddings !== undefined ? { tailPaddings: asr.tailPaddings } : {}),
      },
    },
  };
}

/** Carrega o modelo sem travar o processo (`createAsync`); cada fala é decodificada com `decodeAsync`. */
export async function createSherpaRecognizer(
  models: Pick<ResolvedVoiceModels, 'asr' | 'numThreads'>,
  sherpa = loadSherpa(),
): Promise<RecognizerBackend> {
  const native = await sherpa.OfflineRecognizer.createAsync(sherpaRecognizerConfig(models));
  return {
    async transcribe(samples, sampleRate) {
      const stream = native.createStream();
      stream.acceptWaveform({ samples, sampleRate });
      const result = await native.decodeAsync(stream);
      return result.text ?? '';
    },
  };
}

// ---------------------------------------------------------------- síntese

/**
 * Transforma texto em fonemas IPA, um texto por frase (ex.: saída do espeak-ng ou do
 * piper-phonemize para pt-BR). A sherpa-onnx 2.x não traz mais o espeak-ng: sem léxico,
 * o Kokoro e o Piper só falam com fonemas prontos.
 */
export type Phonemizer = (text: string, lang: string) => Promise<string[]> | string[];

/**
 * Fonemas IPA → códigos Unicode por frase, como a sherpa espera. Normaliza em NFD:
 * os modelos conhecem a vogal e o til (U+0303) separados, não "ẽ" ou "õ" prontos.
 */
export function toPhonemeCodepoints(sentences: readonly string[]): number[][] {
  return sentences
    .map((s) => s.normalize('NFD').trim())
    .filter((s) => s.length > 0)
    .map((s) => Array.from(s, (c) => c.codePointAt(0) ?? 0));
}

export function sherpaTtsConfig(
  models: Pick<ResolvedVoiceModels, 'tts' | 'numThreads'>,
): SherpaOfflineTtsConfig {
  const { tts, numThreads } = models;
  const lexicon = tts.lexicon !== undefined ? { lexicon: tts.lexicon } : {};
  const common = { numThreads, debug: false, provider: 'cpu' };
  if (tts.kind === 'kokoro') {
    return {
      model: {
        ...common,
        kokoro: { model: tts.model, voices: tts.voices, tokens: tts.tokens, ...lexicon },
      },
      maxNumSentences: 1,
    };
  }
  return {
    model: {
      ...common,
      vits: {
        model: tts.model,
        tokens: tts.tokens,
        ...lexicon,
        lengthScale: tts.lengthScale,
        ...(tts.noiseScale !== undefined ? { noiseScale: tts.noiseScale } : {}),
        ...(tts.noiseScaleW !== undefined ? { noiseScaleW: tts.noiseScaleW } : {}),
      },
    },
    maxNumSentences: 1,
  };
}

export interface SherpaTtsOptions {
  /** Obrigatório se o modelo não tiver léxico. */
  phonemizer?: Phonemizer | undefined;
}

/** Carrega o modelo com `createAsync` e gera com `generateAsync` (não trava o processo). */
export async function createSherpaTts(
  models: Pick<ResolvedVoiceModels, 'tts' | 'numThreads'>,
  options: SherpaTtsOptions = {},
  sherpa = loadSherpa(),
): Promise<TtsBackend> {
  const { tts } = models;
  const { phonemizer } = options;
  if (!phonemizer && tts.lexicon === undefined) {
    throw new VoiceModelError(
      `A voz ${tts.kind} precisa de um léxico ou de um fonetizador (a sherpa-onnx 2.x não traz mais o espeak-ng).`,
    );
  }
  const native = await sherpa.OfflineTts.createAsync(sherpaTtsConfig(models));
  return {
    sampleRate: native.sampleRate,
    async generate(text: string, voice: Voice): Promise<SynthesizedAudio> {
      if (voice.sid >= native.numSpeakers) {
        throw new VoiceModelError(
          `Voz ${voice.sid} não existe neste modelo (tem ${native.numSpeakers}).`,
        );
      }
      const request: SherpaTtsRequest = {
        text,
        sid: voice.sid,
        speed: voice.speed,
        enableExternalBuffer: false,
      };
      if (phonemizer) {
        const phonemeCodepoints = toPhonemeCodepoints(await phonemizer(text, tts.lang));
        if (phonemeCodepoints.length === 0) {
          return { samples: new Float32Array(0), sampleRate: native.sampleRate };
        }
        request.generationConfig = { sid: voice.sid, speed: voice.speed, phonemeCodepoints };
      }
      const audio = await native.generateAsync(request);
      return { samples: audio.samples, sampleRate: audio.sampleRate };
    },
  };
}

// ---------------------------------------------------------------- tudo junto

export interface VoiceEngineOptions extends SherpaTtsOptions {
  /** Configuração (validada com zod); caminhos relativos a `modelsDir`. */
  config: unknown;
  modelsDir: string;
  listener?: Omit<ListenerOptions, 'sampleRate'>;
}

export interface VoiceEngine {
  listener: Listener;
  synthesizer: Synthesizer;
  models: ResolvedVoiceModels;
}

/** Valida a configuração, confere os arquivos e carrega VAD, reconhecimento e síntese. */
export async function createVoiceEngine(options: VoiceEngineOptions): Promise<VoiceEngine> {
  const models = resolveVoiceModels(options.config, options.modelsDir);
  const sherpa = loadSherpa();
  const [recognizer, tts] = await Promise.all([
    createSherpaRecognizer(models, sherpa),
    createSherpaTts(models, { phonemizer: options.phonemizer }, sherpa),
  ]);
  const vad = createSherpaVad(models.vad, sherpa);
  return {
    listener: new Listener(vad, recognizer, {
      ...options.listener,
      sampleRate: VOICE_SAMPLE_RATE,
    }),
    synthesizer: new Synthesizer(tts, { sid: models.tts.sid, speed: models.tts.speed }),
    models,
  };
}

import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

/**
 * Configuração dos modelos de voz. Os caminhos são relativos à pasta de modelos
 * (ex.: `models/voz`); dá para escolher o reconhecimento (Parakeet ou Whisper) e a
 * síntese (Kokoro ou Piper) sem mudar código.
 */

const modelFile = z.string().trim().min(1);

export const vadConfigSchema = z.object({
  /** Silero VAD v5. */
  model: modelFile.default('silero_vad_v5.onnx'),
  /** Probabilidade mínima para contar como fala. */
  threshold: z.number().min(0.05).max(0.95).default(0.5),
  /** Silêncio (s) que encerra uma fala. */
  minSilenceDuration: z.number().min(0.05).max(5).default(0.5),
  /** Fala mais curta que isso (s) nem vira segmento. */
  minSpeechDuration: z.number().min(0.05).max(5).default(0.25),
  /** Fala mais longa que isso (s) é cortada em pedaços (o Whisper só vê 30 s). */
  maxSpeechDuration: z.number().min(1).max(29).default(20),
  /** O Silero v5 a 16 kHz trabalha com janelas de 512 amostras. */
  windowSize: z.literal(512).default(512),
});

export const asrConfigSchema = z.discriminatedUnion('kind', [
  z.object({
    /** NeMo transducer (ex.: Parakeet TDT 0.6b v3 int8). */
    kind: z.literal('nemo_transducer'),
    encoder: modelFile,
    decoder: modelFile,
    joiner: modelFile,
    tokens: modelFile,
  }),
  z.object({
    kind: z.literal('whisper'),
    encoder: modelFile,
    decoder: modelFile,
    tokens: modelFile,
    language: z.string().trim().min(2).default('pt'),
    task: z.enum(['transcribe', 'translate']).default('transcribe'),
    tailPaddings: z.number().int().min(-1).max(3000).optional(),
  }),
]);

export const ttsConfigSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('kokoro'),
    model: modelFile,
    voices: modelFile,
    tokens: modelFile,
    /** Léxico (palavra → fonemas). Sem ele, a fala precisa de um fonetizador. */
    lexicon: modelFile.optional(),
    /** Idioma do fonetizador. A sherpa-onnx 2.x ignora o `lang` do Kokoro. */
    lang: z.string().trim().min(2).default('pt-br'),
    /** pf_dora = 42, pm_alex = 43, pm_santa = 44 no kokoro-multi-lang-v1_0. */
    sid: z.number().int().min(0).default(42),
    speed: z.number().min(0.5).max(2).default(1),
  }),
  z.object({
    /** Piper (VITS). */
    kind: z.literal('piper'),
    model: modelFile,
    tokens: modelFile,
    lexicon: modelFile.optional(),
    lang: z.string().trim().min(2).default('pt-br'),
    /** Duração dos fonemas (maior = mais devagar). A velocidade por fala divide este valor. */
    lengthScale: z.number().min(0.3).max(3).default(1),
    noiseScale: z.number().min(0).max(2).optional(),
    noiseScaleW: z.number().min(0).max(2).optional(),
    sid: z.number().int().min(0).default(0),
    speed: z.number().min(0.5).max(2).default(1),
  }),
]);

export const voiceConfigSchema = z.object({
  vad: vadConfigSchema.default(() => vadConfigSchema.parse({})),
  asr: asrConfigSchema,
  tts: ttsConfigSchema,
  /** Threads da CPU para o reconhecimento e a síntese (o VAD usa 1). */
  numThreads: z.number().int().min(1).max(16).default(2),
});

export type VadConfig = z.infer<typeof vadConfigSchema>;
export type AsrConfig = z.infer<typeof asrConfigSchema>;
export type TtsConfig = z.infer<typeof ttsConfigSchema>;
export type VoiceConfig = z.infer<typeof voiceConfigSchema>;
export type VoiceConfigInput = z.input<typeof voiceConfigSchema>;

/** Erro de configuração ou de modelo ausente, com mensagem pronta para mostrar. */
export class VoiceModelError extends Error {
  constructor(
    message: string,
    /** Caminhos que faltam no disco. */
    readonly missing: readonly string[] = [],
  ) {
    super(message);
    this.name = 'VoiceModelError';
  }
}

export function parseVoiceConfig(raw: unknown): VoiceConfig {
  const parsed = voiceConfigSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const issues = parsed.error.issues
    .map((issue) => `${issue.path.join('.') || '(raiz)'}: ${issue.message}`)
    .join('; ');
  throw new VoiceModelError(`Configuração de voz inválida: ${issues}`);
}

/** Configuração com todos os caminhos já absolutos e conferidos no disco. */
export interface ResolvedVoiceModels {
  vad: VadConfig;
  asr: AsrConfig;
  tts: TtsConfig;
  numThreads: number;
}

const FILE_KEYS = {
  vad: ['model'],
  nemo_transducer: ['encoder', 'decoder', 'joiner', 'tokens'],
  whisper: ['encoder', 'decoder', 'tokens'],
  kokoro: ['model', 'voices', 'tokens', 'lexicon'],
  piper: ['model', 'tokens', 'lexicon'],
} as const;

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** Troca cada caminho relativo pelo absoluto e anota os que não existem. */
function resolveFiles<T extends object>(
  section: T,
  keys: readonly string[],
  modelsDir: string,
  missing: string[],
): T {
  const out = { ...section } as Record<string, unknown>;
  for (const key of keys) {
    const value = out[key];
    if (typeof value !== 'string') continue;
    const full = resolve(modelsDir, value);
    if (!isFile(full)) missing.push(full);
    out[key] = full;
  }
  return out as T;
}

/**
 * Valida a configuração e confere se cada arquivo de modelo existe em `modelsDir`.
 * Lança `VoiceModelError` com a lista do que falta.
 */
export function resolveVoiceModels(raw: unknown, modelsDir: string): ResolvedVoiceModels {
  const config = parseVoiceConfig(raw);
  const missing: string[] = [];
  const resolved: ResolvedVoiceModels = {
    vad: resolveFiles(config.vad, FILE_KEYS.vad, modelsDir, missing),
    asr: resolveFiles(config.asr, FILE_KEYS[config.asr.kind], modelsDir, missing),
    tts: resolveFiles(config.tts, FILE_KEYS[config.tts.kind], modelsDir, missing),
    numThreads: config.numThreads,
  };
  if (missing.length > 0) {
    const list = missing.join(', ');
    throw new VoiceModelError(
      `${missing.length === 1 ? 'Modelo de voz não encontrado' : 'Modelos de voz não encontrados'}: ${list}. Rode npm run models:pull.`,
      missing,
    );
  }
  return resolved;
}

/** Peças prontas com os nomes dos pacotes da sherpa-onnx (pasta de cada modelo dentro de `modelsDir`). */
export const VOICE_PRESETS = {
  vad: { model: 'silero_vad_v5.onnx' },
  asr: {
    parakeet: {
      kind: 'nemo_transducer',
      encoder: 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/encoder.int8.onnx',
      decoder: 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/decoder.int8.onnx',
      joiner: 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/joiner.int8.onnx',
      tokens: 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/tokens.txt',
    },
    whisperSmall: {
      kind: 'whisper',
      encoder: 'sherpa-onnx-whisper-small/small-encoder.int8.onnx',
      decoder: 'sherpa-onnx-whisper-small/small-decoder.int8.onnx',
      tokens: 'sherpa-onnx-whisper-small/small-tokens.txt',
      language: 'pt',
      task: 'transcribe',
    },
  },
  tts: {
    kokoro: {
      kind: 'kokoro',
      // fp32: no i5-4440 (Haswell) é 3x mais rápido que o int8 (docs/voz-modelos.md).
      model: 'kokoro-multi-lang-v1_0/model.onnx',
      voices: 'kokoro-multi-lang-v1_0/voices.bin',
      tokens: 'kokoro-multi-lang-v1_0/tokens.txt',
      lang: 'pt-br',
      sid: 42,
      speed: 1,
    },
    piperDii: {
      kind: 'piper',
      model: 'vits-piper-pt_BR-dii-high-int8/pt_BR-dii-high.onnx',
      tokens: 'vits-piper-pt_BR-dii-high-int8/tokens.txt',
      lang: 'pt-br',
      sid: 0,
      speed: 1,
    },
    piperMiro: {
      kind: 'piper',
      model: 'vits-piper-pt_BR-miro-high-int8/pt_BR-miro-high.onnx',
      tokens: 'vits-piper-pt_BR-miro-high-int8/tokens.txt',
      lang: 'pt-br',
      sid: 0,
      speed: 1,
    },
  },
} as const satisfies {
  vad: z.input<typeof vadConfigSchema>;
  asr: Record<string, z.input<typeof asrConfigSchema>>;
  tts: Record<string, z.input<typeof ttsConfigSchema>>;
};

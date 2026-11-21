import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  parseVoiceConfig,
  resolveVoiceModels,
  VOICE_PRESETS,
  VoiceModelError,
  type VoiceConfigInput,
} from './config.js';

const parakeetKokoro: VoiceConfigInput = {
  asr: VOICE_PRESETS.asr.parakeet,
  tts: VOICE_PRESETS.tts.kokoro,
};

describe('parseVoiceConfig', () => {
  it('preenche os padrões', () => {
    const config = parseVoiceConfig(parakeetKokoro);
    expect(config.vad).toMatchObject({ model: 'silero_vad_v5.onnx', windowSize: 512 });
    expect(config.numThreads).toBe(2);
    expect(config.tts).toMatchObject({ kind: 'kokoro', sid: 42, speed: 1 });
  });

  it('Whisper sai em português, transcrevendo', () => {
    const config = parseVoiceConfig({
      asr: { kind: 'whisper', encoder: 'e.onnx', decoder: 'd.onnx', tokens: 't.txt' },
      tts: VOICE_PRESETS.tts.piperDii,
    });
    expect(config.asr).toMatchObject({ kind: 'whisper', language: 'pt', task: 'transcribe' });
    expect(config.tts).toMatchObject({ kind: 'piper', lengthScale: 1, sid: 0 });
  });

  it('erro claro em pt-BR', () => {
    expect(() => parseVoiceConfig({ asr: { kind: 'vosk' }, tts: {} })).toThrow(
      /Configuração de voz inválida: asr/,
    );
    expect(() => parseVoiceConfig({ ...parakeetKokoro, vad: { windowSize: 256 } })).toThrow(
      VoiceModelError,
    );
    expect(() =>
      parseVoiceConfig({ ...parakeetKokoro, tts: { ...VOICE_PRESETS.tts.kokoro, speed: 5 } }),
    ).toThrow(/tts\.speed/);
  });
});

describe('resolveVoiceModels', () => {
  let dir: string;

  const touch = (rel: string) => {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, '');
  };

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'stella-voz-'));
    touch(VOICE_PRESETS.vad.model);
    for (const rel of Object.values(VOICE_PRESETS.asr.parakeet)) if (rel.includes('/')) touch(rel);
    for (const key of ['model', 'voices', 'tokens'] as const) touch(VOICE_PRESETS.tts.kokoro[key]);
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('troca os caminhos relativos pelos absolutos', () => {
    const models = resolveVoiceModels(parakeetKokoro, dir);
    expect(models.vad.model).toBe(join(dir, 'silero_vad_v5.onnx'));
    expect(models.asr.kind === 'nemo_transducer' && models.asr.joiner).toBe(
      join(dir, VOICE_PRESETS.asr.parakeet.joiner),
    );
    expect(models.tts.kind === 'kokoro' && models.tts.voices).toBe(
      join(dir, VOICE_PRESETS.tts.kokoro.voices),
    );
  });

  it('lista os arquivos que faltam e manda rodar o models:pull', () => {
    let error: unknown;
    try {
      resolveVoiceModels(
        { asr: VOICE_PRESETS.asr.whisperSmall, tts: VOICE_PRESETS.tts.piperMiro },
        dir,
      );
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(VoiceModelError);
    const e = error as VoiceModelError;
    expect(e.message).toMatch(/^Modelos de voz não encontrados: .*Rode npm run models:pull\.$/);
    expect(e.missing).toHaveLength(5); // 3 do Whisper + 2 do Piper
  });

  it('um só arquivo faltando fica no singular', () => {
    expect(() =>
      resolveVoiceModels(
        { ...parakeetKokoro, tts: { ...VOICE_PRESETS.tts.kokoro, lexicon: 'falta.txt' } },
        dir,
      ),
    ).toThrow(/^Modelo de voz não encontrado: .*falta\.txt\. Rode npm run models:pull\.$/);
  });

  it('uma pasta no lugar do arquivo também conta como ausente', () => {
    expect(() =>
      resolveVoiceModels({ ...parakeetKokoro, vad: { model: 'kokoro-int8-multi-lang-v1_0' } }, dir),
    ).toThrow(VoiceModelError);
  });
});

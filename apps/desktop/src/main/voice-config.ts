import { join } from 'node:path';
import { VOICE_PRESETS } from '@stella/core';
import type { VoiceChoice } from './voice-controller.js';

/**
 * Modelos de voz usados pela Stella (pastas dentro de models/voz, baixadas pelo
 * `npm run models:pull`). Escolhidos pela avaliação em docs/voz-modelos.md.
 */
export const VOICE_MODELS = {
  // 0,4 s de silêncio fecha a fala (0,5 s somava mais tempo de espera à resposta).
  vad: { ...VOICE_PRESETS.vad, minSilenceDuration: 0.4 },
  asr: VOICE_PRESETS.asr.parakeet,
  tts: VOICE_PRESETS.tts.kokoro,
};

/**
 * Vozes do Kokoro (id do falante no modelo multilíngue v1.0). As de outras línguas falam
 * com os fonemas do português; o reconhecimento entendeu todas sem erro.
 */
export const KOKORO_VOICES: Record<string, number> = {
  ef_dora: 28,
  ff_siwis: 30,
  if_sara: 35,
  pf_dora: 42,
  pm_alex: 43,
  pm_santa: 44,
};

/** Voz padrão por gênero, se a persona não disser qual usar. */
const DEFAULT_VOICE = { feminine: 'pf_dora', masculine: 'pm_alex' } as const;

export interface PersonaVoiceInfo {
  gender: 'feminine' | 'masculine';
  voice?: { voiceId: string; speed: number } | undefined;
}

/** Voz e velocidade de uma persona (persona.json → id do falante no Kokoro). */
export function voiceForPersona(persona: PersonaVoiceInfo | undefined): VoiceChoice {
  const fallback = DEFAULT_VOICE[persona?.gender ?? 'feminine'];
  const sid = KOKORO_VOICES[persona?.voice?.voiceId ?? ''] ?? KOKORO_VOICES[fallback] ?? 42;
  const speed = persona?.voice?.speed ?? 1;
  return { sid, speed: Math.min(2, Math.max(0.5, speed)) };
}

/** Pasta dos modelos de voz: STELLA_VOICE_MODELS ou models/voz na raiz do projeto. */
export function voiceModelsDir(root: string, env = process.env): string {
  return env['STELLA_VOICE_MODELS'] ?? join(root, 'models', 'voz');
}

/** espeak-ng (fonemas), extraído pelo models:pull junto dos modelos. */
export function espeakPath(modelsDir: string, env = process.env): string {
  return env['STELLA_ESPEAK'] ?? join(modelsDir, 'espeak-ng', 'eSpeak NG', 'espeak-ng.exe');
}

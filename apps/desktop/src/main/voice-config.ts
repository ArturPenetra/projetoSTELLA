import { join } from 'node:path';
import { VOICE_PRESETS } from '@stella/core';
import type { VoiceChoice } from './voice-controller.js';

/**
 * Modelos de voz usados pela Stella (pastas dentro de models/voz, baixadas pelo
 * `npm run models:pull`). Reconhecimento em docs/voz-modelos.md; voz (Supertonic 3, mais
 * fluida que o Kokoro e sem espeak-ng) em docs/voz-tts-candidatos.md.
 */
export const VOICE_MODELS = {
  // 0,4 s de silêncio fecha a fala (0,5 s somava mais tempo de espera à resposta).
  vad: { ...VOICE_PRESETS.vad, minSilenceDuration: 0.4 },
  asr: VOICE_PRESETS.asr.parakeet,
  tts: VOICE_PRESETS.tts.supertonic,
};

/** Estilos de voz do Supertonic 3 (id no `voice.bin`): F = femininas, M = masculinas. */
export const VOICES: Record<string, number> = {
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
};

/** Voz padrão por gênero, se a persona não disser qual usar. */
const DEFAULT_VOICE = { feminine: 'F1', masculine: 'M1' } as const;

export interface PersonaVoiceInfo {
  gender: 'feminine' | 'masculine';
  voice?: { voiceId: string; speed: number } | undefined;
}

/** Voz e velocidade de uma persona (persona.json → estilo do Supertonic). */
export function voiceForPersona(persona: PersonaVoiceInfo | undefined): VoiceChoice {
  const fallback = DEFAULT_VOICE[persona?.gender ?? 'feminine'];
  const sid = VOICES[persona?.voice?.voiceId ?? ''] ?? VOICES[fallback] ?? 0;
  const speed = persona?.voice?.speed ?? 1;
  return { sid, speed: Math.min(2, Math.max(0.5, speed)) };
}

/** Pasta dos modelos de voz: STELLA_VOICE_MODELS ou models/voz na raiz do projeto. */
export function voiceModelsDir(root: string, env = process.env): string {
  return env['STELLA_VOICE_MODELS'] ?? join(root, 'models', 'voz');
}

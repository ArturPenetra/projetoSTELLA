/**
 * Mensagens entre o processo principal e o processo de voz (utilityProcess). O processo de
 * voz carrega os modelos (reconhecimento, VAD, síntese) e é encerrado ao desligar a voz:
 * assim toda a memória dos modelos volta ao sistema.
 */
export interface VoiceWorkerStart {
  type: 'start';
  /** Configuração de voz (validada no processo de voz com zod). */
  config: unknown;
  modelsDir: string;
  /** espeak-ng.exe, para os fonemas (só para vozes que usam fonemas, como o Kokoro). */
  espeak?: string | undefined;
}

export type ToVoiceWorker =
  | VoiceWorkerStart
  | { type: 'feed'; chunk: Float32Array }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'synth'; id: number; text: string; sid: number; speed: number }
  | { type: 'cancel' };

export type FromVoiceWorker =
  | { type: 'ready' }
  | { type: 'error'; message: string }
  | { type: 'speech-start' }
  | { type: 'text'; text: string }
  | { type: 'audio'; id: number; samples?: Float32Array; sampleRate?: number; error?: string };

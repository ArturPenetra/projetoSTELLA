import { join } from 'node:path';
import { utilityProcess, type UtilityProcess } from 'electron';
import type { FromVoiceWorker, ToVoiceWorker, VoiceWorkerStart } from '../voice-worker/protocol.js';
import type { VoiceChoice, VoiceEngine } from './voice-controller.js';

/** Quanto esperar os modelos carregarem (a frio, no HD, leva alguns segundos). */
const START_TIMEOUT_MS = 90_000;

export interface VoiceEngineClientOptions extends Omit<VoiceWorkerStart, 'type'> {
  onText: (text: string) => void;
  onSpeechStart?: () => void;
}

/**
 * Motor de voz num processo separado (utilityProcess). Desligar a voz encerra o processo:
 * toda a memória dos modelos volta ao sistema, sem depender do coletor de lixo.
 */
export class VoiceEngineClient implements VoiceEngine {
  private child: UtilityProcess | undefined;
  private nextId = 0;
  private readonly waiting = new Map<
    number,
    (audio: { samples: Float32Array; sampleRate: number } | undefined) => void
  >();

  constructor(private readonly options: VoiceEngineClientOptions) {}

  private post(msg: ToVoiceWorker): void {
    this.child?.postMessage(msg);
  }

  start(): Promise<void> {
    const child = utilityProcess.fork(join(import.meta.dirname, 'voice-worker.js'), [], {
      serviceName: 'Stella - voz',
      stdio: 'inherit',
    });
    this.child = child;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.stop();
        reject(new Error('Os modelos de voz demoraram demais para carregar.'));
      }, START_TIMEOUT_MS);
      const fail = (message: string) => {
        clearTimeout(timer);
        this.stop();
        reject(new Error(message));
      };
      child.on('exit', (code) => {
        if (this.child === child) {
          this.child = undefined;
          this.flushWaiting();
          fail(`O processo de voz fechou (código ${code}).`);
        }
      });
      child.on('message', (msg: FromVoiceWorker) => {
        switch (msg.type) {
          case 'ready':
            clearTimeout(timer);
            resolve();
            break;
          case 'error':
            fail(msg.message);
            break;
          case 'text':
            this.options.onText(msg.text);
            break;
          case 'speech-start':
            this.options.onSpeechStart?.();
            break;
          case 'audio': {
            const done = this.waiting.get(msg.id);
            this.waiting.delete(msg.id);
            if (msg.error) console.warn('[voz] não consegui falar uma frase:', msg.error);
            done?.(
              msg.samples instanceof Float32Array && msg.sampleRate
                ? { samples: msg.samples, sampleRate: msg.sampleRate }
                : undefined,
            );
            break;
          }
        }
      });
      const { config, modelsDir, espeak } = this.options;
      this.post({ type: 'start', config, modelsDir, espeak });
    });
  }

  private flushWaiting(): void {
    for (const done of this.waiting.values()) done(undefined);
    this.waiting.clear();
  }

  stop(): void {
    const child = this.child;
    this.child = undefined;
    this.flushWaiting();
    child?.kill();
  }

  feed(chunk: Float32Array): void {
    this.post({ type: 'feed', chunk });
  }

  pauseListening(): void {
    this.post({ type: 'pause' });
  }

  resumeListening(): void {
    this.post({ type: 'resume' });
  }

  synthesize(text: string, voice: VoiceChoice) {
    if (!this.child) return Promise.resolve(undefined);
    const id = ++this.nextId;
    return new Promise<{ samples: Float32Array; sampleRate: number } | undefined>((resolve) => {
      this.waiting.set(id, resolve);
      this.post({ type: 'synth', id, text, sid: voice.sid, speed: voice.speed });
    });
  }

  cancelSynthesis(): void {
    this.post({ type: 'cancel' });
  }
}

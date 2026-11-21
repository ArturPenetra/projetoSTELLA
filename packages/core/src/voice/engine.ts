import type { AudioClip } from './audio.js';
import { speakable } from './sentences.js';

/**
 * Motor de voz: ouvir (VAD + reconhecimento) e falar (síntese em fila). A sherpa-onnx
 * fica atrás das interfaces `VadBackend`, `RecognizerBackend` e `TtsBackend`
 * (`sherpa.ts`); os testes usam versões falsas.
 */

/** Detector de fala (Silero). Recebe áudio mono na taxa do microfone (16 kHz). */
export interface VadBackend {
  acceptWaveform(samples: Float32Array): void;
  /** Há fala agora (o usuário está falando). */
  isDetected(): boolean;
  /** Tira as falas completas detectadas até aqui, na ordem. */
  popSegments(): Float32Array[];
  /** Fim do áudio: fecha a fala em andamento, se houver, como segmento. */
  flush(): void;
  /** Esquece tudo (fala em andamento e segmentos pendentes). */
  reset(): void;
}

/** Reconhecimento de uma fala inteira (offline). */
export interface RecognizerBackend {
  transcribe(samples: Float32Array, sampleRate: number): Promise<string>;
}

/** Quem fala e em que velocidade (1 = normal). */
export interface Voice {
  sid: number;
  speed: number;
}

export type SynthesizedAudio = AudioClip;

/** Síntese de fala. Recebe texto já limpo (`speakable`). */
export interface TtsBackend {
  readonly sampleRate: number;
  generate(text: string, voice: Voice): Promise<SynthesizedAudio>;
}

// ---------------------------------------------------------------- transcrição

/**
 * Frases que o reconhecimento inventa em silêncio ou ruído (o Whisper aprendeu com
 * legendas de vídeo). Ninguém diz isso para a Stella; se a frase inteira for uma
 * delas, é descartada.
 */
const HALLUCINATIONS: readonly RegExp[] = [
  /amara\.org/i,
  /^legendas?\b/i,
  /^legendado\b/i,
  /^(transcri[cç][aã]o|tradu[cç][aã]o) (e|por)\b/i,
  /inscreva-se\b/i,
  /^(obrigad[oa] )?(por|pela) (assistir|aten[cç][aã]o)\b/i,
  /^ative o sininho\b/i,
  /^deixe (seu|o) like\b/i,
  /^(sous-titres|subtitles) /i,
];

/**
 * Limpa o texto reconhecido: tira anotações (`[Música]`, `(risos)`, ♪), espaços a mais e
 * alucinações comuns. Devolve '' se não sobrar fala de verdade (só pontuação, etc.).
 */
export function cleanTranscript(text: string): string {
  const clean = text
    .replace(/\[[^\]]*\]|\([^)]*\)|<[^>]*>|[♪♫]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!/[\p{L}\p{N}]/u.test(clean)) return '';
  if (HALLUCINATIONS.some((re) => re.test(clean))) return '';
  return clean;
}

// ---------------------------------------------------------------- ouvir

export interface ListenerEvents {
  /** O usuário começou a falar (para interromper a Stella). */
  'speech-start': () => void;
  /** O usuário parou de falar (a transcrição vem depois, em `text`). */
  'speech-end': () => void;
  /** Uma fala transcrita, já limpa. */
  text: (text: string) => void;
  /** Falha ao transcrever: a fala se perde, mas o ouvinte segue funcionando. */
  error: (error: unknown) => void;
}

export interface ListenerOptions {
  /** Taxa do áudio recebido em `feed` (a do VAD). Padrão: 16000. */
  sampleRate?: number;
  /** Falas mais curtas que isso (s) são ignoradas (tosse, clique). Padrão: 0,3. */
  minSegmentSeconds?: number;
}

type Handlers = { [K in keyof ListenerEvents]: Set<ListenerEvents[K]> };

/**
 * Ouve o microfone: recebe pedaços de áudio, acha as falas com o VAD e transcreve cada
 * uma, uma de cada vez e na ordem. Meio-duplex: `pause()` enquanto a Stella fala.
 */
export class Listener {
  private readonly sampleRate: number;
  private readonly minSamples: number;
  private readonly handlers: Handlers = {
    'speech-start': new Set(),
    'speech-end': new Set(),
    text: new Set(),
    error: new Set(),
  };
  private speaking = false;
  private paused = false;
  /** Muda em `reset()`: transcrições antigas que terminarem depois são descartadas. */
  private epoch = 0;
  private queue: Promise<void> = Promise.resolve();
  private pendingCount = 0;

  constructor(
    private readonly vad: VadBackend,
    private readonly recognizer: RecognizerBackend,
    options: ListenerOptions = {},
  ) {
    this.sampleRate = options.sampleRate ?? 16_000;
    this.minSamples = Math.round((options.minSegmentSeconds ?? 0.3) * this.sampleRate);
  }

  on<K extends keyof ListenerEvents>(event: K, handler: ListenerEvents[K]): () => void {
    this.handlers[event].add(handler);
    return () => this.handlers[event].delete(handler);
  }

  get isPaused(): boolean {
    return this.paused;
  }

  /** O usuário está falando agora. */
  get isSpeaking(): boolean {
    return this.speaking;
  }

  /** Transcrições na fila ou em andamento. */
  get pending(): number {
    return this.pendingCount;
  }

  /** Um pedaço do microfone (mono, `sampleRate`). Pausado, o áudio é descartado. */
  feed(chunk: Float32Array): void {
    if (this.paused || chunk.length === 0) return;
    this.vad.acceptWaveform(chunk);
    this.update();
  }

  /** Fim do áudio (microfone fechado, fim do arquivo): a fala em andamento é transcrita. */
  flush(): void {
    if (this.paused) return;
    this.vad.flush();
    this.update(true);
  }

  /** Para de ouvir (a Stella vai falar). A fala em andamento é descartada; as já completas seguem. */
  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.vad.reset();
    this.endSpeech();
  }

  resume(): void {
    if (!this.paused) return;
    this.vad.reset();
    this.paused = false;
  }

  /** Esquece tudo: fala em andamento e transcrições pendentes (os resultados são descartados). */
  reset(): void {
    this.epoch++;
    this.vad.reset();
    this.endSpeech();
  }

  /** Espera as transcrições pendentes terminarem. */
  idle(): Promise<void> {
    return this.queue;
  }

  private update(ended = false): void {
    const detected = !ended && this.vad.isDetected();
    const segments = this.vad.popSegments();
    if ((detected || segments.length > 0) && !this.speaking) {
      this.speaking = true;
      this.emit('speech-start');
    }
    if (!detected) this.endSpeech();
    for (const segment of segments) this.transcribe(segment);
  }

  private endSpeech(): void {
    if (!this.speaking) return;
    this.speaking = false;
    this.emit('speech-end');
  }

  private transcribe(segment: Float32Array): void {
    if (segment.length < this.minSamples) return;
    const epoch = this.epoch;
    this.pendingCount++;
    this.queue = this.queue.then(async () => {
      try {
        if (epoch !== this.epoch) return;
        const raw = await this.recognizer.transcribe(segment, this.sampleRate);
        if (epoch !== this.epoch) return;
        const text = cleanTranscript(raw);
        if (text) this.emit('text', text);
      } catch (error) {
        if (epoch === this.epoch) this.emit('error', error);
      } finally {
        this.pendingCount--;
      }
    });
  }

  private emit<K extends keyof ListenerEvents>(
    event: K,
    ...args: Parameters<ListenerEvents[K]>
  ): void {
    for (const handler of this.handlers[event]) {
      try {
        (handler as (...a: Parameters<ListenerEvents[K]>) => void)(...args);
      } catch {
        // Um ouvinte com defeito não pode parar o microfone.
      }
    }
  }
}

// ---------------------------------------------------------------- falar

interface Job {
  text: string;
  voice: Voice;
  epoch: number;
  settled: boolean;
  resolve: (audio: SynthesizedAudio | undefined) => void;
  reject: (error: unknown) => void;
}

/**
 * Sintetiza as frases na ordem em que chegam, uma de cada vez. `cancel()` (Esc, o
 * usuário interrompeu) descarta a fila e o resultado da frase em andamento: essas
 * promessas resolvem `undefined`.
 */
export class Synthesizer {
  private readonly queue: Job[] = [];
  private current: Job | undefined;
  private running = false;
  private epoch = 0;

  constructor(
    private readonly backend: TtsBackend,
    private readonly defaultVoice: Voice,
  ) {}

  get sampleRate(): number {
    return this.backend.sampleRate;
  }

  /** Frases esperando ou em síntese. */
  get pending(): number {
    return this.queue.length + (this.current ? 1 : 0);
  }

  /**
   * Põe a frase na fila. Limpa com `speakable()` antes; sem nada para falar (só emoji,
   * pontuação), resolve `undefined` na hora.
   */
  synthesize(text: string, voice: Partial<Voice> = {}): Promise<SynthesizedAudio | undefined> {
    const clean = speakable(text);
    if (!clean) return Promise.resolve(undefined);
    return new Promise((resolve, reject) => {
      this.queue.push({
        text: clean,
        voice: { ...this.defaultVoice, ...voice },
        epoch: this.epoch,
        settled: false,
        resolve,
        reject,
      });
      void this.pump();
    });
  }

  /** Descarta a fila e o resultado da frase em andamento. */
  cancel(): void {
    this.epoch++;
    for (const job of this.queue.splice(0)) settle(job, undefined);
    if (this.current) settle(this.current, undefined);
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (let job = this.queue.shift(); job; job = this.queue.shift()) {
        if (job.epoch !== this.epoch) {
          settle(job, undefined);
          continue;
        }
        this.current = job;
        try {
          // Uma de cada vez: mesmo cancelada, a síntese nativa termina antes da próxima.
          const audio = await this.backend.generate(job.text, job.voice);
          settle(job, job.epoch === this.epoch ? audio : undefined);
        } catch (error) {
          if (job.epoch === this.epoch) fail(job, error);
          else settle(job, undefined);
        } finally {
          this.current = undefined;
        }
      }
    } finally {
      this.running = false;
    }
  }
}

function settle(job: Job, audio: SynthesizedAudio | undefined): void {
  if (job.settled) return;
  job.settled = true;
  job.resolve(audio);
}

function fail(job: Job, error: unknown): void {
  if (job.settled) return;
  job.settled = true;
  job.reject(error);
}

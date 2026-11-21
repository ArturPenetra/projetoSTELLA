/**
 * Partes puras da janela de áudio (sem WebAudio), testadas sozinhas:
 * reamostragem do microfone para 16 kHz em pedaços fixos, volume (RMS) da fala,
 * fila de reprodução e mensagens de erro do microfone.
 */
import type { PlayedEvent, PlayRequest } from '../shared/voice.js';

/** Nome do processador registrado em voice-worklet.ts. */
export const MIC_PROCESSOR = 'stella-mic';

/**
 * Converte o áudio do microfone (na taxa da placa, ex.: 48000 Hz) para `outputRate`
 * e entrega pedaços de exatamente `chunkSize` amostras.
 *
 * Para reduzir a taxa, cada amostra de saída é a média das amostras de entrada do seu
 * intervalo (filtro de média, que já corta boa parte do serrilhado acima de 8 kHz; para
 * reconhecer fala basta). Funciona com razões fracionárias (44100 → 16000) e guarda o
 * estado entre chamadas, então os blocos de 128 amostras do AudioWorklet podem chegar
 * em qualquer tamanho. Se a entrada já for mais lenta que a saída, repete amostras.
 */
export class MicResampler {
  private readonly ratio: number;
  private readonly chunkSize: number;
  /** Posição (em amostras de entrada) onde termina o intervalo da próxima amostra de saída. */
  private boundary: number;
  /** Quantas amostras de entrada já passaram. */
  private consumed = 0;
  private sum = 0;
  private count = 0;
  private last = 0;
  private chunk: Float32Array;
  private filled = 0;

  constructor(inputRate: number, outputRate: number, chunkSize: number) {
    if (!(inputRate > 0) || !(outputRate > 0)) throw new Error('Taxa de amostragem inválida.');
    if (!Number.isInteger(chunkSize) || chunkSize < 1)
      throw new Error('Tamanho de pedaço inválido.');
    this.ratio = inputRate / outputRate;
    this.boundary = this.ratio;
    this.chunkSize = chunkSize;
    this.chunk = new Float32Array(chunkSize);
  }

  /** Recebe mais áudio e devolve os pedaços que ficaram completos (cada um é um array novo). */
  push(input: Float32Array): Float32Array[] {
    const out: Float32Array[] = [];
    for (let i = 0; i < input.length; i++) {
      const sample = input[i] ?? 0;
      this.sum += sample;
      this.count++;
      this.consumed++;
      while (this.consumed >= this.boundary) {
        if (this.count > 0) {
          this.last = this.sum / this.count;
          this.sum = 0;
          this.count = 0;
        }
        this.emit(this.last, out);
        this.boundary += this.ratio;
      }
    }
    // Evita perder precisão com contadores enormes depois de horas ligado.
    if (this.consumed > 1e9) {
      this.boundary -= this.consumed;
      this.consumed = 0;
    }
    return out;
  }

  private emit(value: number, out: Float32Array[]): void {
    this.chunk[this.filled++] = value;
    if (this.filled === this.chunkSize) {
      out.push(this.chunk);
      this.chunk = new Float32Array(this.chunkSize);
      this.filled = 0;
    }
  }
}

/**
 * Ganho do volume: fala normal tem RMS por volta de 0,05 a 0,2; com 5x, fala baixa já
 * abre a boca e fala alta chega perto de 1.
 */
export const LEVEL_GAIN = 5;

/** Volume (RMS) de um trecho, multiplicado por `gain` e limitado a 0..1. */
export function rmsLevel(samples: Float32Array, gain = LEVEL_GAIN): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i] ?? 0;
    sum += s * s;
  }
  const level = Math.sqrt(sum / samples.length) * gain;
  if (!Number.isFinite(level)) return 0;
  return Math.min(1, Math.max(0, level));
}

/** Mensagem em pt-BR para a falha do getUserMedia (pelo `name` do DOMException). */
export function micErrorMessage(errorName: string | undefined): string {
  switch (errorName) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Não tenho permissão para usar o microfone. Confira as configurações de privacidade do Windows (Microfone).';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'Nenhum microfone encontrado. Conecte um microfone e tente de novo.';
    case 'NotReadableError':
    case 'AbortError':
      return 'O microfone não respondeu. Ele pode estar em uso por outro programa.';
    default:
      return 'Não consegui abrir o microfone.';
  }
}

/** Toca um áudio; chama `onEnded` quando ele acabar sozinho. Devolve uma função que para já. */
export type StartPlayback = (req: PlayRequest, onEnded: () => void) => () => void;

/**
 * Fila de reprodução: toca um pedido depois do outro e avisa 'start'/'end' exatamente uma
 * vez para cada um que começou. `stop()` interrompe o atual (manda o 'end' dele) e
 * descarta a fila; os que nunca começaram não geram eventos.
 */
export class PlaybackQueue {
  private readonly queue: PlayRequest[] = [];
  private current: { req: PlayRequest; stop: () => void } | undefined;

  constructor(
    private readonly start: StartPlayback,
    private readonly emit: (event: PlayedEvent) => void,
    /** Chamado quando a fila fica vazia (para zerar o volume da boca). */
    private readonly onIdle: () => void = () => {},
  ) {}

  get playing(): boolean {
    return this.current !== undefined;
  }

  enqueue(req: PlayRequest): void {
    this.queue.push(req);
    if (!this.current) this.next();
  }

  stop(): void {
    this.queue.length = 0;
    const current = this.current;
    if (!current) return;
    this.current = undefined;
    try {
      current.stop();
    } finally {
      this.emit({ id: current.req.id, state: 'end' });
      this.onIdle();
    }
  }

  private next(): void {
    const req = this.queue.shift();
    if (!req) {
      this.onIdle();
      return;
    }
    let ended = false;
    const entry = { req, stop: () => {} };
    this.current = entry;
    this.emit({ id: req.id, state: 'start' });
    const onEnded = () => {
      // Ignora o fim que chega depois de um stop() ou duas vezes.
      if (ended || this.current !== entry) return;
      ended = true;
      this.current = undefined;
      this.emit({ id: req.id, state: 'end' });
      this.next();
    };
    try {
      entry.stop = this.start(req, onEnded);
    } catch {
      // Áudio que não dá para tocar (vazio, taxa inválida): conta como tocado e segue.
      onEnded();
    }
  }
}

/** Utilitários de áudio puros (sem dependências nativas). Amostras em Float32 de -1 a 1. */

export interface AudioClip {
  samples: Float32Array;
  sampleRate: number;
}

const WAVE_FORMAT_PCM = 1;
const WAVE_FORMAT_EXTENSIBLE = 0xfffe;

function fourcc(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

/**
 * Lê um WAV PCM de 16 bits. Com mais de um canal, devolve a média (mono).
 * Lança erro em pt-BR para qualquer outro formato.
 */
export function parseWav(data: Uint8Array): AudioClip {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data.byteLength < 12 || fourcc(view, 0) !== 'RIFF' || fourcc(view, 8) !== 'WAVE') {
    throw new Error('WAV inválido: o arquivo não começa com RIFF/WAVE.');
  }
  let format: { channels: number; sampleRate: number; bits: number; tag: number } | undefined;
  let offset = 12;
  while (offset + 8 <= data.byteLength) {
    const id = fourcc(view, offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === 'fmt ') {
      if (size < 16 || body + 16 > data.byteLength)
        throw new Error('WAV inválido: bloco fmt curto.');
      format = {
        tag: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bits: view.getUint16(body + 14, true),
      };
      if (format.tag === WAVE_FORMAT_EXTENSIBLE && size >= 26) {
        format.tag = view.getUint16(body + 24, true);
      }
    } else if (id === 'data') {
      if (!format) throw new Error('WAV inválido: dados antes do bloco fmt.');
      if (format.tag !== WAVE_FORMAT_PCM || format.bits !== 16) {
        throw new Error(
          `WAV não suportado: só PCM de 16 bits (veio formato ${format.tag}, ${format.bits} bits).`,
        );
      }
      if (format.channels < 1 || format.sampleRate < 1) {
        throw new Error('WAV inválido: canais ou taxa de amostragem zerados.');
      }
      // Arquivos gravados em fluxo às vezes trazem tamanho errado: usa o que existe.
      const available = Math.min(size, data.byteLength - body);
      const frames = Math.floor(available / (2 * format.channels));
      const samples = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        let sum = 0;
        for (let c = 0; c < format.channels; c++) {
          sum += view.getInt16(body + (i * format.channels + c) * 2, true);
        }
        samples[i] = sum / format.channels / 32768;
      }
      return { samples, sampleRate: format.sampleRate };
    }
    offset = body + size + (size % 2); // blocos têm tamanho par
  }
  throw new Error('WAV inválido: bloco data não encontrado.');
}

/**
 * Muda a taxa de amostragem por interpolação linear. Simples e sem filtro: serve para
 * fala (ex.: 22050 → 16000 para o VAD), não para música. Devolve a própria entrada se
 * as taxas forem iguais.
 */
export function resampleLinear(samples: Float32Array, from: number, to: number): Float32Array {
  if (!(from > 0) || !(to > 0)) throw new RangeError('Taxa de amostragem precisa ser positiva.');
  if (from === to || samples.length === 0) return samples;
  const length = Math.max(1, Math.round((samples.length * to) / from));
  const out = new Float32Array(length);
  const step = from / to;
  const last = samples.length - 1;
  for (let i = 0; i < length; i++) {
    const pos = i * step;
    const i0 = Math.min(Math.floor(pos), last);
    const i1 = Math.min(i0 + 1, last);
    const frac = pos - i0;
    const a = samples[i0] ?? 0;
    const b = samples[i1] ?? 0;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

/** Divide o áudio em pedaços de `size` amostras (o último pode ser menor), sem copiar. */
export function* chunks(samples: Float32Array, size: number): Generator<Float32Array> {
  if (!Number.isInteger(size) || size < 1) throw new RangeError('Tamanho do pedaço inválido.');
  for (let i = 0; i < samples.length; i += size) yield samples.subarray(i, i + size);
}

/** Duração em segundos. */
export function durationOf(clip: AudioClip): number {
  return clip.samples.length / clip.sampleRate;
}

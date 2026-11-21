/**
 * AudioWorklet do microfone: roda na thread de áudio, reamostra para 16 kHz e manda
 * pedaços de 512 amostras pela porta. O Vite empacota este arquivo à parte
 * (`?worker&url` em voice.ts), com o MicResampler dentro.
 */
import { MIC_CHUNK_SAMPLES, MIC_SAMPLE_RATE } from '../shared/voice.js';
import { MIC_PROCESSOR, MicResampler } from './voice-audio.js';

// Tipos do escopo do AudioWorklet (não fazem parte da lib "DOM" do TypeScript).
declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(
  name: string,
  processor: new () => AudioWorkletProcessor & {
    process(inputs: Float32Array[][]): boolean;
  },
): void;

class MicProcessor extends AudioWorkletProcessor {
  private readonly resampler = new MicResampler(sampleRate, MIC_SAMPLE_RATE, MIC_CHUNK_SAMPLES);

  process(inputs: Float32Array[][]): boolean {
    // Mono: o getUserMedia já pede 1 canal; se vier mais de um, usa o primeiro.
    const channel = inputs[0]?.[0];
    if (channel && channel.length > 0) {
      for (const chunk of this.resampler.push(channel)) {
        this.port.postMessage(chunk, [chunk.buffer]);
      }
    }
    return true;
  }
}

registerProcessor(MIC_PROCESSOR, MicProcessor);

/**
 * Processo de voz (Electron utilityProcess, sem janelas e sem acesso ao chat). Recebe o
 * microfone e as frases a falar; devolve o texto ouvido e o áudio sintetizado.
 */
import {
  createEspeakPhonemizer,
  createVoiceEngine,
  type Listener,
  type Synthesizer,
} from '@stella/core';
import type { FromVoiceWorker, ToVoiceWorker } from './protocol.js';

const port = process.parentPort;
const send = (msg: FromVoiceWorker) => port.postMessage(msg);

let listener: Listener | undefined;
let synthesizer: Synthesizer | undefined;

async function start(msg: Extract<ToVoiceWorker, { type: 'start' }>): Promise<void> {
  try {
    const phonemizer = createEspeakPhonemizer({ exe: msg.espeak });
    const engine = await createVoiceEngine({
      config: msg.config,
      modelsDir: msg.modelsDir,
      phonemizer,
    });
    listener = engine.listener;
    synthesizer = engine.synthesizer;
    listener.on('speech-start', () => send({ type: 'speech-start' }));
    listener.on('text', (text) => send({ type: 'text', text }));
    listener.on('error', (err) => console.warn('[voz] não entendi um trecho', err));
    send({ type: 'ready' });
  } catch (err) {
    send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
}

async function synth(msg: Extract<ToVoiceWorker, { type: 'synth' }>): Promise<void> {
  try {
    const audio = await synthesizer?.synthesize(msg.text, { sid: msg.sid, speed: msg.speed });
    if (!audio) {
      send({ type: 'audio', id: msg.id });
      return;
    }
    send({ type: 'audio', id: msg.id, samples: audio.samples, sampleRate: audio.sampleRate });
  } catch (err) {
    send({ type: 'audio', id: msg.id, error: err instanceof Error ? err.message : String(err) });
  }
}

port.on('message', (event: { data: ToVoiceWorker }) => {
  const msg = event.data;
  switch (msg.type) {
    case 'start':
      void start(msg);
      break;
    case 'feed':
      if (msg.chunk instanceof Float32Array) listener?.feed(msg.chunk);
      break;
    case 'pause':
      listener?.pause();
      break;
    case 'resume':
      listener?.resume();
      break;
    case 'synth':
      void synth(msg);
      break;
    case 'cancel':
      synthesizer?.cancel();
      break;
  }
});

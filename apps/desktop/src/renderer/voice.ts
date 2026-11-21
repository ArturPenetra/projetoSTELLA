/**
 * Janela de áudio (oculta): abre o microfone e manda pedaços de 16 kHz para o processo
 * principal; toca as falas que ele manda, uma depois da outra, e informa o volume.
 * Não tem interface nem acesso a nada além de window.voiceio.
 */
import type { VoiceIoApi } from '../shared/voice.js';
import { MIC_PROCESSOR, micErrorMessage, PlaybackQueue, rmsLevel } from './voice-audio.js';
import workletUrl from './voice-worklet.ts?worker&url';

declare global {
  interface Window {
    voiceio: VoiceIoApi;
  }
}

const api = window.voiceio;

/** Volume da fala ~30 vezes por segundo. */
const LEVEL_INTERVAL_MS = 33;

// Um só contexto para microfone e reprodução. Sem gesto do usuário ele pode nascer
// suspenso; a janela é criada com autoplay liberado, e mesmo assim tentamos retomar.
const ctx = new AudioContext({ latencyHint: 'interactive' });
function resume(): void {
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
}

// --- Microfone --------------------------------------------------------------------------

async function startMic(): Promise<void> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
  } catch (err) {
    const name = err instanceof DOMException ? err.name : undefined;
    console.warn(`[voz] microfone falhou: ${name ?? String(err)}`);
    api.sendMicState({ ok: false, error: micErrorMessage(name) });
    return;
  }

  try {
    await ctx.audioWorklet.addModule(workletUrl);
    resume();
    const source = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, MIC_PROCESSOR, {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 1,
      channelCountMode: 'explicit',
    });
    node.port.onmessage = (e: MessageEvent<unknown>) => {
      if (e.data instanceof Float32Array) api.sendMicChunk(e.data);
    };
    source.connect(node);
  } catch (err) {
    console.warn('[voz] não consegui processar o microfone:', err);
    for (const track of stream.getTracks()) track.stop();
    api.sendMicState({ ok: false, error: micErrorMessage(undefined) });
    return;
  }

  for (const track of stream.getAudioTracks()) {
    track.addEventListener('ended', () =>
      api.sendMicState({ ok: false, error: 'O microfone foi desconectado.' }),
    );
  }
  api.sendMicState({ ok: true });
}

// --- Reprodução -------------------------------------------------------------------------

const analyser = ctx.createAnalyser();
analyser.fftSize = 1024;
analyser.connect(ctx.destination);
const levelBuffer = new Float32Array(analyser.fftSize);
let levelTimer: ReturnType<typeof setInterval> | undefined;

function startLevel(): void {
  if (levelTimer) return;
  levelTimer = setInterval(() => {
    analyser.getFloatTimeDomainData(levelBuffer);
    api.sendLevel(rmsLevel(levelBuffer));
  }, LEVEL_INTERVAL_MS);
}

function stopLevel(): void {
  if (levelTimer) {
    clearInterval(levelTimer);
    levelTimer = undefined;
  }
  api.sendLevel(0);
}

const queue = new PlaybackQueue(
  (req, onEnded) => {
    resume();
    const buffer = ctx.createBuffer(1, req.samples.length, req.sampleRate);
    buffer.copyToChannel(new Float32Array(req.samples), 0);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(analyser);
    source.onended = onEnded;
    source.start();
    startLevel();
    return () => {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // Já tinha parado.
      }
      source.disconnect();
    };
  },
  (event) => api.sendPlayed(event),
  stopLevel,
);

api.onPlay((req) => queue.enqueue(req));
api.onStop(() => queue.stop());

void startMic();

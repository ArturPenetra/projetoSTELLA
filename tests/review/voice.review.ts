/**
 * Conversa falada com os modelos reais (Ollama aberto e `npm run models:pull` feito): mede
 * o tempo entre o usuário parar de falar e a primeira palavra da resposta. Meta da
 * Fase 7: ~2 s; no i5-4440 a mediana é ~2,9 s, aceita em 21/11/2026 (docs/voz-modelos.md).
 * Roda com `npm run voice:review` e grava test-results/voz-latencia.md.
 *
 * A fala do "usuário" é gerada pela própria síntese (voz masculina) e entra no detector de
 * voz em tempo real, pedaço a pedaço, com o silêncio do fim também em tempo real: assim o
 * tempo que o detector leva para perceber que a pessoa parou de falar entra na conta.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ChatSession,
  chunks,
  createEspeakPhonemizer,
  createVoiceEngine,
  DEFAULT_CHAT_MODEL,
  DEFAULT_OLLAMA_URL,
  loadPersonaCatalog,
  OllamaClient,
  personaSystemPrompt,
  resampleLinear,
  SentenceSplitter,
  signTalkNote,
  VOICE_PRESETS,
  VOICE_SAMPLE_RATE,
} from '@stella/core';
import { expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '../..');
const MODELS = process.env['STELLA_VOICE_MODELS'] ?? join(ROOT, 'models', 'voz');
const ESPEAK =
  process.env['STELLA_ESPEAK'] ?? join(MODELS, 'espeak-ng', 'eSpeak NG', 'espeak-ng.exe');
const CHUNK = 512;
const CHUNK_MS = (CHUNK / VOICE_SAMPLE_RATE) * 1000;

const PEDIDOS = [
  'Oi, Leo, tudo bem com você hoje?',
  'Me dá uma dica rápida para começar o dia com energia.',
  'Estou cansado de estudar, o que eu faço?',
  'Qual é uma boa ideia para o fim de semana?',
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

it('primeira palavra em até ~3 s depois que o usuário para de falar (mediana)', async () => {
  const catalog = loadPersonaCatalog(join(ROOT, 'personas'));
  const leo = catalog.get('leo');
  if (!leo) throw new Error('persona leo ausente');
  const llm = new OllamaClient({ baseUrl: DEFAULT_OLLAMA_URL, model: DEFAULT_CHAT_MODEL });
  const status = await llm.status();
  expect(status.state, 'Abra o Ollama').toBe('ready');

  const loadStart = performance.now();
  const engine = await createVoiceEngine({
    config: {
      vad: { ...VOICE_PRESETS.vad, minSilenceDuration: 0.4 },
      numThreads: Number(process.env['VOICE_THREADS'] ?? 2),
      asr: VOICE_PRESETS.asr.parakeet,
      tts: VOICE_PRESETS.tts.kokoro,
    },
    modelsDir: MODELS,
    phonemizer: createEspeakPhonemizer({ exe: ESPEAK }),
  });
  const loadMs = performance.now() - loadStart;
  const { listener, synthesizer } = engine;

  // Aquece o modelo de chat e a síntese (a primeira chamada a frio não é o uso normal).
  const warm = new ChatSession(llm, {
    speaker: {
      id: leo.id,
      name: leo.name,
      systemPrompt: personaSystemPrompt(leo, catalog),
      turnNote: signTalkNote,
    },
  });
  for await (const _ of warm.send('Oi')) void _;
  await synthesizer.synthesize('Olá.', { sid: 42, speed: 1 });

  const rows: string[] = [];
  const totals: number[] = [];
  for (const pedido of PEDIDOS) {
    // Fala do usuário (voz masculina pm_alex), em 16 kHz, com 1,5 s de silêncio no fim.
    const spoken = await synthesizer.synthesize(pedido, { sid: 43, speed: 1 });
    if (!spoken) throw new Error('não sintetizou a fala do usuário');
    const speech = resampleLinear(spoken.samples, spoken.sampleRate, VOICE_SAMPLE_RATE);
    const audio = new Float32Array(speech.length + VOICE_SAMPLE_RATE * 1.5);
    audio.set(speech);

    let stoppedAt = 0;
    let heardAt = 0;
    const heard = new Promise<string>((resolve) => {
      const off = listener.on('text', (text) => {
        heardAt = performance.now();
        off();
        resolve(text);
      });
    });
    let fed = 0;
    for (const chunk of chunks(audio, CHUNK)) {
      const start = performance.now();
      listener.feed(chunk);
      fed += chunk.length;
      if (!stoppedAt && fed >= speech.length) stoppedAt = performance.now();
      // Tempo real: um pedaço a cada 32 ms, como o microfone.
      await sleep(Math.max(0, CHUNK_MS - (performance.now() - start)));
      if (heardAt) break;
    }
    const text = await Promise.race([heard, sleep(8000).then(() => '')]);
    expect(text, `não reconheceu: ${pedido}`).not.toBe('');

    // Resposta do Leo, falada a partir da primeira frase pronta.
    const session = new ChatSession(llm, {
      speaker: {
        id: leo.id,
        name: leo.name,
        systemPrompt: personaSystemPrompt(leo, catalog),
        turnNote: signTalkNote,
      },
    });
    const splitter = new SentenceSplitter();
    let firstSentence = '';
    let firstSentenceAt = 0;
    let reply = '';
    for await (const c of session.send(text)) {
      if (c.type !== 'token') continue;
      reply += c.text;
      if (!firstSentence) {
        const ready = splitter.push(c.text);
        if (ready[0]) {
          firstSentence = ready[0];
          firstSentenceAt = performance.now();
          break;
        }
      }
    }
    if (!firstSentence) {
      firstSentence = splitter.flush()[0] ?? reply;
      firstSentenceAt = performance.now();
    }
    const audioOut = await synthesizer.synthesize(firstSentence, { sid: 43, speed: 1.1 });
    const firstAudioAt = performance.now();
    expect(audioOut?.samples.length ?? 0).toBeGreaterThan(0);

    const ouvir = heardAt - stoppedAt;
    const pensar = firstSentenceAt - heardAt;
    const falar = firstAudioAt - firstSentenceAt;
    const total = firstAudioAt - stoppedAt;
    totals.push(total);
    rows.push(
      `| ${pedido} | ${text} | ${firstSentence} | ${ouvir.toFixed(0)} | ${pensar.toFixed(0)} | ${falar.toFixed(0)} | **${total.toFixed(0)}** |`,
    );
  }

  const report = [
    '# Voz: latência até a primeira palavra',
    '',
    `Modelo de chat ${DEFAULT_CHAT_MODEL}; reconhecimento Parakeet TDT 0.6b v3 int8; síntese Kokoro v1.0 fp32 + espeak-ng; VAD fecha a fala com 0,4 s de silêncio. Carregar os modelos de voz: ${(loadMs / 1000).toFixed(1)} s.`,
    '',
    'Tempos em ms, a partir do fim da fala do usuário. "Ouvir" inclui o detector perceber o silêncio (0,4 s) e o reconhecimento.',
    '',
    '| Pedido falado | Reconhecido | Primeira frase | Ouvir | Pensar | Falar | Total |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...rows,
    '',
    `Mediana: **${median(totals).toFixed(0)} ms**.`,
    '',
  ].join('\n');
  mkdirSync(join(ROOT, 'test-results'), { recursive: true });
  writeFileSync(join(ROOT, 'test-results', 'voz-latencia.md'), report);
  console.log(report);
  // Aceito em 21/11/2026: ~2,9 s no i5-4440 com o Kokoro (licença livre, vozes distintas).
  expect(median(totals)).toBeLessThan(3500);
});

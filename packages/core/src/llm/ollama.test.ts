import { createServer } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { startFakeOllama, type FakeOllama } from '../testing/fake-ollama.js';
import { LlmError } from './errors.js';
import { OllamaClient, sameModel } from './ollama.js';
import type { ChatChunk } from './types.js';

let fake: FakeOllama | undefined;
afterEach(async () => {
  await fake?.close();
  fake = undefined;
});

async function collect(stream: AsyncIterable<ChatChunk>): Promise<ChatChunk[]> {
  const out: ChatChunk[] = [];
  for await (const chunk of stream) out.push(chunk);
  return out;
}

async function catchError(promise: Promise<unknown>): Promise<LlmError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(LlmError);
    return err as LlmError;
  }
  throw new Error('era esperado um erro');
}

/** Porta local livre, sem ninguém escutando (simula Ollama desligado). */
async function deadPort(): Promise<string> {
  const srv = createServer();
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const { port } = srv.address() as { port: number };
  await new Promise<void>((r) => srv.close(() => r()));
  return `http://127.0.0.1:${port}`;
}

describe('OllamaClient', () => {
  it('recusa endereço que não é local', () => {
    expect(() => new OllamaClient({ baseUrl: 'https://ollama.exemplo.com', model: 'x' })).toThrow(
      LlmError,
    );
  });

  it('responde em streaming, pedaço por pedaço', async () => {
    fake = await startFakeOllama({ reply: ['Oi', ', eu sou', ' a Stella.'] });
    const client = new OllamaClient({ baseUrl: fake.url, model: 'qwen3.5:2b' });

    const chunks = await collect(client.chat([{ role: 'user', content: 'Oi' }]));

    const tokens = chunks.filter((c) => c.type === 'token').map((c) => c.text);
    expect(tokens).toEqual(['Oi', ', eu sou', ' a Stella.']);
    expect(chunks.at(-1)).toEqual({ type: 'done', stats: { outputTokens: 3, totalMs: 3 } });
  });

  it('envia modelo, mensagens e opções esperadas', async () => {
    fake = await startFakeOllama();
    const client = new OllamaClient({
      baseUrl: fake.url,
      model: 'qwen3.5:2b',
      temperature: 0.5,
      contextSize: 4096,
    });
    await collect(client.chat([{ role: 'user', content: 'teste' }]));

    expect(fake.requests[0]).toEqual({
      model: 'qwen3.5:2b',
      messages: [{ role: 'user', content: 'teste' }],
      stream: true,
      think: false,
      options: { temperature: 0.5, num_ctx: 4096 },
    });
  });

  it('com o Ollama desligado, gera erro "unavailable" com mensagem clara', async () => {
    const client = new OllamaClient({ baseUrl: await deadPort(), model: 'qwen3.5:2b' });
    const err = await catchError(collect(client.chat([{ role: 'user', content: 'Oi' }])));
    expect(err.code).toBe('unavailable');
    expect(err.message).toMatch(/Ollama/);
  });

  it('modelo não instalado vira "model_missing"', async () => {
    fake = await startFakeOllama({ models: ['outro:1b'] });
    const client = new OllamaClient({ baseUrl: fake.url, model: 'qwen3.5:2b' });
    const err = await catchError(collect(client.chat([{ role: 'user', content: 'Oi' }])));
    expect(err.code).toBe('model_missing');
    expect(err.message).toMatch(/models:pull/);
  });

  it('erro no meio do streaming é repassado', async () => {
    fake = await startFakeOllama({ chatMode: 'error-line' });
    const client = new OllamaClient({ baseUrl: fake.url, model: 'qwen3.5:2b' });
    const err = await catchError(collect(client.chat([{ role: 'user', content: 'Oi' }])));
    expect(err.code).toBe('http');
    expect(err.message).toMatch(/sem memória/);
  });

  it('resposta cortada ou inválida vira "bad_response"', async () => {
    fake = await startFakeOllama({ chatMode: 'truncated' });
    let client = new OllamaClient({ baseUrl: fake.url, model: 'qwen3.5:2b' });
    expect((await catchError(collect(client.chat([])))).code).toBe('bad_response');
    await fake.close();

    fake = await startFakeOllama({ chatMode: 'garbage' });
    client = new OllamaClient({ baseUrl: fake.url, model: 'qwen3.5:2b' });
    expect((await catchError(collect(client.chat([])))).code).toBe('bad_response');
  });

  it('erro HTTP genérico informa o status', async () => {
    fake = await startFakeOllama({ chatMode: 'http-500' });
    const client = new OllamaClient({ baseUrl: fake.url, model: 'qwen3.5:2b' });
    const err = await catchError(collect(client.chat([])));
    expect(err.code).toBe('http');
    expect(err.message).toMatch(/500/);
  });

  it('pode ser cancelado no meio da resposta', async () => {
    fake = await startFakeOllama({ reply: ['a', 'b', 'c', 'd', 'e'], delayMs: 30 });
    const client = new OllamaClient({ baseUrl: fake.url, model: 'qwen3.5:2b' });
    const controller = new AbortController();
    const received: string[] = [];

    const err = await catchError(
      (async () => {
        for await (const chunk of client.chat([], { signal: controller.signal })) {
          if (chunk.type === 'token') received.push(chunk.text);
          if (received.length === 2) controller.abort();
        }
      })(),
    );

    expect(err.code).toBe('aborted');
    expect(received).toEqual(['a', 'b']);
  });

  describe('status', () => {
    it('pronto quando o modelo está instalado', async () => {
      fake = await startFakeOllama({ models: ['qwen3.5:2b'] });
      const client = new OllamaClient({ baseUrl: fake.url, model: 'qwen3.5:2b' });
      expect(await client.status()).toEqual({
        state: 'ready',
        version: '0.40.16',
        model: 'qwen3.5:2b',
      });
    });

    it('avisa quando falta o modelo', async () => {
      fake = await startFakeOllama({ models: [] });
      const client = new OllamaClient({ baseUrl: fake.url, model: 'qwen3.5:2b' });
      expect((await client.status()).state).toBe('model_missing');
    });

    it('indisponível sem travar quando o Ollama está desligado', async () => {
      const client = new OllamaClient({ baseUrl: await deadPort(), model: 'qwen3.5:2b' });
      const status = await client.status();
      expect(status.state).toBe('unavailable');
    });
  });
});

describe('sameModel', () => {
  it('trata a tag :latest como padrão', () => {
    expect(sameModel('bge-m3:latest', 'bge-m3')).toBe(true);
    expect(sameModel('qwen3.5:2b', 'qwen3.5:2b')).toBe(true);
    expect(sameModel('qwen3.5:4b', 'qwen3.5:2b')).toBe(false);
  });
});

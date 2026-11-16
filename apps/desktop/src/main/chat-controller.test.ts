import { OllamaClient } from '@stella/core';
import { startFakeOllama } from '@stella/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChatEvent } from '../shared/ipc.js';
import { ChatController } from './chat-controller.js';

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((c) => c()));
});

async function setup(options: Parameters<typeof startFakeOllama>[0] = {}) {
  const fake = await startFakeOllama(options);
  closers.push(fake.close);
  const events: ChatEvent[] = [];
  const controller = new ChatController(
    new OllamaClient({ baseUrl: fake.url, model: 'qwen3.5:2b' }),
    (e) => events.push(e),
  );
  return { controller, events };
}

describe('ChatController', () => {
  it('transmite os tokens e termina com "done"', async () => {
    const { controller, events } = await setup({ reply: ['Oi', '!'] });
    const { requestId } = controller.send('Olá');
    await controller.idle();

    expect(events.map((e) => e.type)).toEqual(['token', 'token', 'done']);
    expect(events.every((e) => e.requestId === requestId)).toBe(true);
  });

  it('valida a mensagem recebida do renderer', async () => {
    const { controller } = await setup();
    expect(() => controller.send('')).toThrow(/vazia/);
    expect(() => controller.send(42)).toThrow(/vazia/);
    expect(() => controller.send('x'.repeat(9000))).toThrow(/longa demais/);
  });

  it('não aceita duas respostas ao mesmo tempo', async () => {
    const { controller } = await setup({ delayMs: 20 });
    controller.send('primeira');
    expect(() => controller.send('segunda')).toThrow(/Espere/);
    await controller.idle();
    expect(() => controller.send('terceira')).not.toThrow();
    await controller.idle();
  });

  it('cancelar gera erro "aborted" e libera para a próxima', async () => {
    const { controller, events } = await setup({ reply: ['a', 'b', 'c', 'd'], delayMs: 30 });
    const { requestId } = controller.send('oi');
    await new Promise((r) => setTimeout(r, 40));
    controller.cancel(requestId);
    await controller.idle();

    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'aborted' });
  });

  it('Ollama desligado vira evento de erro, sem derrubar nada', async () => {
    const fake = await startFakeOllama();
    const url = fake.url;
    await fake.close();
    const events: ChatEvent[] = [];
    const controller = new ChatController(
      new OllamaClient({ baseUrl: url, model: 'qwen3.5:2b' }),
      (e) => events.push(e),
    );
    controller.send('oi');
    await controller.idle();
    expect(events).toEqual([expect.objectContaining({ type: 'error', code: 'unavailable' })]);
  });
});

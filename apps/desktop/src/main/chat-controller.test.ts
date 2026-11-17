import { OllamaClient } from '@stella/core';
import { startFakeOllama } from '@stella/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChatEvent } from '../shared/ipc.js';
import { ChatController, type ChatSpeaker } from './chat-controller.js';

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((c) => c()));
});

const leo: ChatSpeaker = { id: 'leo', name: 'Leo', element: 'fogo', systemPrompt: 'Você é o Leo.' };
const pixi: ChatSpeaker = {
  id: 'pixi',
  name: 'Pixi',
  element: 'agua',
  systemPrompt: 'Você é a Pixi.',
};

async function setup(options: Parameters<typeof startFakeOllama>[0] = {}) {
  const fake = await startFakeOllama(options);
  closers.push(fake.close);
  const events: ChatEvent[] = [];
  const controller = new ChatController(
    new OllamaClient({ baseUrl: fake.url, model: 'qwen3.5:2b' }),
    (e) => events.push(e),
    { speaker: leo },
  );
  return { controller, events, fake };
}

describe('ChatController', () => {
  it('transmite os tokens e termina com "done"', async () => {
    const { controller, events } = await setup({ reply: ['Oi', '!'] });
    const { requestId } = controller.send('Olá');
    await controller.idle();

    expect(events.map((e) => e.type)).toEqual(['start', 'token', 'token', 'done']);
    expect(events[0]).toMatchObject({ speaker: { id: 'leo', name: 'Leo', element: 'fogo' } });
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
    expect(events).toEqual([
      expect.objectContaining({ type: 'start' }),
      expect.objectContaining({ type: 'error', code: 'unavailable' }),
    ]);
  });

  describe('troca de persona', () => {
    it('sem conversa, a nova persona diz o cumprimento dela', async () => {
      const { controller, events, fake } = await setup();
      await controller.switchTo(pixi, { greeting: 'Oi... como você está?', handoff: 'x' });
      expect(events.map((e) => e.type)).toEqual(['start', 'token', 'done']);
      expect(events[0]).toMatchObject({ speaker: { id: 'pixi' } });
      expect(events[1]).toMatchObject({ text: 'Oi... como você está?' });
      expect(fake.requests).toHaveLength(0);
      expect(controller.hasHistory).toBe(true);
    });

    it('com conversa, a nova persona recebe a instrução oculta e o histórico rotulado', async () => {
      const { controller, events, fake } = await setup({ reply: ['Bora!'] });
      controller.send('Quero treinar mais');
      await controller.idle();
      events.length = 0;

      await controller.switchTo(pixi, { handoff: '(troca de persona)', greeting: 'não usar' });
      await controller.idle();
      expect(events[0]).toMatchObject({ type: 'start', speaker: { id: 'pixi' } });
      expect(events.at(-1)).toMatchObject({ type: 'done' });

      const request = fake.requests.at(-1);
      expect(request?.messages).toEqual([
        { role: 'system', content: 'Você é a Pixi.' },
        { role: 'user', content: 'Quero treinar mais' },
        { role: 'assistant', content: '[Leo] Bora!' },
        { role: 'user', content: '(troca de persona)' },
      ]);
      expect(controller.currentSpeaker.id).toBe('pixi');
    });

    it('cancela a resposta em andamento antes de trocar', async () => {
      const { controller, events } = await setup({ reply: ['a', 'b', 'c'], delayMs: 50 });
      controller.send('oi');
      await controller.switchTo(pixi, { greeting: 'Oi!' });
      expect(events.some((e) => e.type === 'error' && e.code === 'aborted')).toBe(true);
      expect(events.at(-1)).toMatchObject({ type: 'done' });
    });

    it('nova conversa mantém a persona atual', async () => {
      const { controller } = await setup();
      await controller.switchTo(pixi);
      controller.reset();
      expect(controller.currentSpeaker.id).toBe('pixi');
      expect(controller.hasHistory).toBe(false);
    });
  });
});

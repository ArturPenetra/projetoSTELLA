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

/** Linhas da transcrição que vão no prompt de sistema quando outra persona já falou. */
function transcript(request: { messages: { content: string }[] } | undefined): string[] {
  const system = request?.messages[0]?.content ?? '';
  const start = system.indexOf('Conversa até agora');
  return start < 0 ? [] : system.slice(start).split('\n').slice(1);
}

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
      expect(events[0]).toMatchObject({ kind: 'handoff' });
      // Cumprimento não é conversa: o usuário ainda não disse nada.
      expect(controller.hasConversation).toBe(false);
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
      expect(request?.messages[0]?.content.startsWith('Você é a Pixi.')).toBe(true);
      expect(transcript(request)).toEqual(['Usuário: Quero treinar mais', 'Leo: Bora!']);
      expect(request?.messages.slice(1)).toEqual([{ role: 'user', content: '(troca de persona)' }]);
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
      expect(controller.hasConversation).toBe(false);
    });

    const corni: ChatSpeaker = {
      id: 'corni',
      name: 'Corni',
      element: 'terra',
      systemPrompt: 'Você é a Corni.',
    };
    const aqua: ChatSpeaker = {
      id: 'aqua',
      name: 'Aqua',
      element: 'ar',
      systemPrompt: 'Você é a Aqua.',
    };

    it('trocas seguidas: só o cumprimento da última persona fica, no histórico e na tela', async () => {
      const { controller, events, fake } = await setup({ reply: ['Fala!'] });
      controller.send('Quero correr 5 km');
      await controller.idle();
      const recents: string[][] = [];
      const handoff = (r: string[]) => {
        recents.push(r);
        return '(troca)';
      };

      for (const p of [pixi, corni, aqua]) {
        await controller.switchTo(p, { handoff });
        await controller.idle();
      }

      // Cada troca recebeu o que o usuário disse por último.
      expect(recents).toEqual([
        ['Quero correr 5 km'],
        ['Quero correr 5 km'],
        ['Quero correr 5 km'],
      ]);
      // As duas primeiras falas por conta própria foram retiradas da tela.
      const starts = events.filter((e) => e.type === 'start' && e.kind === 'handoff');
      const retracted = events.filter((e) => e.type === 'retract').map((e) => e.requestId);
      expect(retracted).toEqual(starts.slice(0, 2).map((e) => e.requestId));
      // A Aqua vê a conversa real e nenhuma fila de cumprimentos.
      expect(transcript(fake.requests.at(-1))).toEqual([
        'Usuário: Quero correr 5 km',
        'Leo: Fala!',
      ]);
      expect(fake.requests.at(-1)?.messages.slice(1)).toEqual([
        { role: 'user', content: '(troca)' },
      ]);

      // Depois que o usuário responde, o cumprimento passa a fazer parte da conversa.
      controller.send('Bora');
      await controller.idle();
      await controller.switchTo(pixi, { handoff });
      await controller.idle();
      expect(transcript(fake.requests.at(-1))).toEqual([
        'Usuário: Quero correr 5 km',
        'Leo: Fala!',
        'Aqua: Fala!',
        'Usuário: Bora',
        'Aqua: Fala!',
      ]);
      expect(recents.at(-1)).toEqual(['Quero correr 5 km', 'Bora']);
    });

    it('troca no meio de outra troca cancela a primeira, sem deixar resto', async () => {
      const { controller, events } = await setup({ reply: ['a', 'b', 'c', 'd'], delayMs: 40 });
      controller.send('oi');
      await controller.idle();
      void controller.switchTo(pixi, { handoff: '(troca)' });
      await new Promise((r) => setTimeout(r, 60));
      await controller.switchTo(corni, { handoff: '(troca)' });
      await controller.idle();
      const pixiStart = events.find((e) => e.type === 'start' && e.speaker.id === 'pixi');
      expect(events).toContainEqual(
        expect.objectContaining({
          requestId: pixiStart?.requestId,
          type: 'error',
          code: 'aborted',
        }),
      );
      expect(events).toContainEqual({ requestId: pixiStart?.requestId, type: 'retract' });
      expect(events.at(-1)).toMatchObject({ type: 'done' });
    });
  });
});

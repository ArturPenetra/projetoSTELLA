import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPersonaCatalog, OllamaClient } from '@stella/core';
import { startFakeOllama, type FakeOllama } from '@stella/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ChatEvent, PersonaView } from '../shared/ipc.js';
import { ChatController } from './chat-controller.js';
import { loadPalettes, PersonaService } from './persona-service.js';
import { DEFAULT_PROFILE, ProfileStore, type Profile } from './profile.js';

const ROOT = join(import.meta.dirname, '../../../..');
const catalog = loadPersonaCatalog(join(ROOT, 'personas'));
const palettes = loadPalettes(join(ROOT, 'config', 'elements.json'));

describe('PersonaService', () => {
  let dir: string;
  let fake: FakeOllama;
  let events: ChatEvent[];
  let changed: PersonaView[];

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'stella-personas-'));
    fake = await startFakeOllama({ reply: ['Certo!'] });
    events = [];
    changed = [];
  });
  afterEach(async () => {
    await fake.close();
    await rm(dir, { recursive: true, force: true });
  });

  function setup(profile: Profile = DEFAULT_PROFILE) {
    const store = new ProfileStore(dir);
    const ref: { chat?: ChatController } = {};
    const service = new PersonaService(catalog, palettes, store, profile, () => ref.chat);
    const chat = new ChatController(
      new OllamaClient({ baseUrl: fake.url, model: 'qwen3.5:2b' }),
      (e) => events.push(e),
      { speaker: service.speaker() },
    );
    ref.chat = chat;
    service.onChanged((p) => changed.push(p));
    return { service, store, chat };
  }

  const said = () =>
    events
      .filter((e): e is Extract<ChatEvent, { type: 'token' }> => e.type === 'token')
      .map((e) => e.text)
      .join('');

  it('sem escolha salva, começa com a primeira persona ativa', () => {
    const { service } = setup();
    expect(service.current.id).toBe('leo');
    expect(service.onboarded).toBe(false);
    const state = service.state();
    expect(state.personas).toHaveLength(12);
    expect(state.personas.filter((p) => p.status === 'active').map((p) => p.id)).toEqual([
      'leo',
      'corni',
      'aqua',
      'pixi',
    ]);
    expect(state.current.palette).toEqual(palettes.fogo);
  });

  it('volta para a persona salva, se ainda estiver ativa', () => {
    expect(setup({ ...DEFAULT_PROFILE, personaId: 'pixi' }).service.current.id).toBe('pixi');
    expect(setup({ ...DEFAULT_PROFILE, personaId: 'ari' }).service.current.id).toBe('leo');
  });

  it('só deixa escolher personas ativas', async () => {
    const { service } = setup();
    await expect(service.select('ari')).rejects.toThrow('Ari chega em breve.');
    await expect(service.select('ninguem')).rejects.toThrow('Persona inválida.');
    await expect(service.select(42)).rejects.toThrow('Persona inválida.');
  });

  it('trocar salva a escolha, avisa e a nova persona cumprimenta', async () => {
    const { service, store } = setup();
    await service.select('corni');
    expect(service.current.id).toBe('corni');
    expect((await store.load()).personaId).toBe('corni');
    expect(changed.map((p) => p.id)).toEqual(['corni']);
    expect(events[0]).toMatchObject({ type: 'start', speaker: { id: 'corni', element: 'terra' } });
    expect(said()).toBe('Oi. Antes de tudo: o que é prioridade hoje?');
  });

  it('o prompt da persona tem as regras comuns e o prompt.md dela', () => {
    const { service } = setup();
    const prompt = service.speaker(catalog.get('pixi')).systemPrompt;
    expect(prompt).toContain('Você é Pixi, uma das personas do app Stella');
    expect(prompt).toContain('Ninguém consegue prever o futuro');
    expect(prompt).toContain('Você é a Pixi. Fale de si mesma no feminino.');
  });

  it('cita quem ouviu cada fato com o artigo certo', () => {
    const { service } = setup();
    expect(service.label('leo')).toBe('ao Leo');
    expect(service.label('pixi')).toBe('à Pixi');
    expect(service.label('stella')).toBeUndefined();
  });

  describe('onboarding', () => {
    it('com signo: salva signo e preferência, nunca a data, e a persona pergunta o nome', async () => {
      const { service, store } = setup();
      expect(service.signsForDate(1, 3)).toEqual(['pisces']);
      const s = service.suggest('pisces', 'similar');
      expect(s.persona.id).toBe('pixi');

      await service.finishOnboarding({ personaId: 'pixi', sign: 'pisces', preference: 'similar' });
      expect(await store.load()).toEqual({
        onboarded: true,
        personaId: 'pixi',
        sign: 'pisces',
        preference: 'similar',
      });
      expect(await readFile(store.path, 'utf8')).not.toMatch(/"day"|"month"|nascimento/);
      expect(said()).toBe(
        'Oi... que bom que você veio. Como você está se sentindo hoje? Como posso te chamar?',
      );
    });

    it('"prefiro não dizer": não guarda signo nem preferência', async () => {
      const { service, store } = setup();
      await service.finishOnboarding({ personaId: 'aqua', sign: null, preference: 'contrast' });
      expect(await store.load()).toMatchObject({
        onboarded: true,
        personaId: 'aqua',
        sign: null,
        preference: null,
      });
    });

    it('valida o que vem do renderer', async () => {
      const { service } = setup();
      expect(() => service.suggest('ofiuco', 'similar')).toThrow(/inválidos/);
      expect(() => service.suggest('aries', 'qualquer')).toThrow(/inválidos/);
      expect(() => service.signsForDate(31, 2)).toThrow('Essa data não existe');
      expect(() => service.signsForDate('1', 2)).toThrow('Essa data não existe');
      await expect(
        service.finishOnboarding({ personaId: 'corp', sign: null, preference: null }),
      ).rejects.toThrow('Corp chega em breve.');
      await expect(service.finishOnboarding({ personaId: 'leo' })).rejects.toThrow('inválida');
    });

    it('sugestão de uma persona futura explica quem assume', () => {
      const { service } = setup();
      const s = service.suggest('aries', 'similar');
      expect(s).toMatchObject({ ideal: { id: 'ari' }, persona: { id: 'leo' }, standIn: true });
      expect(s.reason).toContain('A Ari chega em breve. Enquanto isso, o Leo');
    });
  });
});

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemoryStore } from './store.js';

const v = (...xs: number[]) => Float32Array.from(xs);

describe('MemoryStore', () => {
  let store: MemoryStore;
  let clock: number;

  beforeEach(() => {
    clock = 1000;
    store = new MemoryStore(':memory:', () => clock++);
  });
  afterEach(() => store.close());

  it('guarda o histórico com a persona de cada mensagem', () => {
    const c = store.startConversation();
    store.addMessage(c, 'user', 'Oi!', 'stella');
    store.addMessage(c, 'assistant', 'Olá!', 'stella');
    expect(store.messages(c)).toEqual([
      { role: 'user', content: 'Oi!', personaId: 'stella' },
      { role: 'assistant', content: 'Olá!', personaId: 'stella' },
    ]);
    store.clearHistory();
    expect(store.messageCount()).toBe(0);
  });

  it('adiciona, edita e apaga fatos', () => {
    const f = store.addFact({
      text: 'O usuário se chama Ana.',
      sensitive: false,
      personaId: 'stella',
    });
    expect(store.listFacts()).toEqual([f]);
    expect(f).toMatchObject({
      text: 'O usuário se chama Ana.',
      sensitive: false,
      personaId: 'stella',
    });

    const edited = store.updateFact(f.id, 'O usuário se chama Ana Clara.');
    expect(edited?.text).toBe('O usuário se chama Ana Clara.');
    expect(edited?.updatedAt).toBeGreaterThan(f.updatedAt);
    expect(store.updateFact(999, 'x')).toBeUndefined();

    expect(store.findSameText('  o usuário se chama ANA CLARA. ')?.id).toBe(f.id);
    expect(store.deleteFact(f.id)).toBe(true);
    expect(store.deleteFact(f.id)).toBe(false);
    expect(store.factCount()).toBe(0);
  });

  it('busca os fatos mais parecidos pelo vetor', () => {
    store.ensureIndex('teste', 3);
    const gato = store.addFact({ text: 'gato', sensitive: false, personaId: 'p' }, v(1, 0, 0));
    const cafe = store.addFact({ text: 'café', sensitive: true, personaId: 'p' }, v(0, 1, 0));
    store.addFact({ text: 'cidade', sensitive: false, personaId: 'p' }, v(0, 0, 1));

    const found = store.nearestFacts(v(0.9, 0.3, 0), 2);
    expect(found.map((m) => m.fact.id)).toEqual([gato.id, cafe.id]);
    expect(found[0]?.distance).toBeLessThan(found[1]?.distance ?? 0);
    expect(found[1]?.fact.sensitive).toBe(true);
  });

  it('apagar ou editar um fato tira o vetor antigo do índice', () => {
    store.ensureIndex('teste', 2);
    const a = store.addFact({ text: 'a', sensitive: false, personaId: 'p' }, v(1, 0));
    const b = store.addFact({ text: 'b', sensitive: false, personaId: 'p' }, v(0, 1));
    store.deleteFact(a.id);
    expect(store.nearestFacts(v(1, 0), 5).map((m) => m.fact.id)).toEqual([b.id]);

    store.updateFact(b.id, 'b editado');
    expect(store.nearestFacts(v(0, 1), 5)).toEqual([]);
    expect(store.factsWithoutEmbedding().map((f) => f.id)).toEqual([b.id]);
  });

  it('trocar o modelo de embedding refaz o índice vazio', () => {
    store.ensureIndex('modelo-a', 2);
    const f = store.addFact({ text: 'x', sensitive: false, personaId: 'p' }, v(1, 0));
    store.ensureIndex('modelo-a', 2);
    expect(store.factsWithoutEmbedding()).toEqual([]);

    store.ensureIndex('modelo-b', 3);
    expect(store.indexedModel).toBe('modelo-b');
    expect(store.factsWithoutEmbedding().map((x) => x.id)).toEqual([f.id]);
    expect(() => store.setEmbedding(f.id, v(1, 0))).toThrow(/3/);
    store.setEmbedding(f.id, v(1, 0, 0));
    expect(store.factsWithoutEmbedding()).toEqual([]);
  });

  it('sem índice, a busca devolve vazio e todos os fatos precisam de vetor', () => {
    store.addFact({ text: 'x', sensitive: false, personaId: 'p' });
    expect(store.nearestFacts(v(1), 3)).toEqual([]);
    expect(store.factsWithoutEmbedding()).toHaveLength(1);
  });

  it('apagar tudo limpa fatos e índice', () => {
    store.ensureIndex('teste', 2);
    store.addFact({ text: 'x', sensitive: false, personaId: 'p' }, v(1, 0));
    store.clearFacts();
    expect(store.factCount()).toBe(0);
    expect(store.nearestFacts(v(1, 0), 3)).toEqual([]);
  });
});

describe('MemoryStore em arquivo', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'stella-mem-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('o que foi salvo continua lá ao reabrir', () => {
    const path = join(dir, 'memoria.db');
    const first = new MemoryStore(path);
    first.ensureIndex('teste', 2);
    first.addFact({ text: 'O usuário se chama Ana.', sensitive: false, personaId: 'p' }, v(1, 0));
    first.close();

    const second = new MemoryStore(path);
    expect(second.listFacts().map((f) => f.text)).toEqual(['O usuário se chama Ana.']);
    expect(second.indexedModel).toBe('teste');
    expect(second.nearestFacts(v(1, 0), 1)[0]?.fact.text).toBe('O usuário se chama Ana.');
    second.close();
  });
});

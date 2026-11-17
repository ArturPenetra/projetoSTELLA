import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChatSession } from '../chat/session.js';
import { LlmError } from '../llm/errors.js';
import type { ChatChunk, ChatMessage, Embedder, LlmClient, LlmStatus } from '../llm/types.js';
import { bagOfWordsEmbedding } from '../testing/fake-ollama.js';
import { FactExtractor, type ExtractedFact } from './extractor.js';
import { formatMemoryPrompt, Memory } from './memory.js';
import { MemoryStore, type Fact } from './store.js';

class WordsEmbedder implements Embedder {
  readonly model = 'palavras';
  calls = 0;
  failing = false;
  async embed(texts: string[]): Promise<Float32Array[]> {
    this.calls++;
    if (this.failing) throw new LlmError('unavailable', 'fora do ar');
    return texts.map((t) => Float32Array.from(bagOfWordsEmbedding(t)));
  }
}

/** Extrator de mentira: "Meu nome é X" e "Eu gosto de X" viram fatos. */
class RuleExtractor extends FactExtractor {
  constructor() {
    super({ complete: async () => '{"facts":[]}' });
  }
  override async extract({ user }: { user: string }): Promise<ExtractedFact[]> {
    const facts: ExtractedFact[] = [];
    const name = /meu nome é (\w+)/i.exec(user);
    if (name) facts.push({ text: `O usuário se chama ${name[1]}.`, sensitive: false });
    for (const m of user.matchAll(/gosto de ([\wà-ú ]+?)(?:[.,!]|$)/gi)) {
      facts.push({ text: `O usuário gosta de ${m[1]}.`, sensitive: false });
    }
    if (/ansiedade/i.test(user)) facts.push({ text: 'O usuário tem ansiedade.', sensitive: true });
    return facts;
  }
}

class EchoLlm implements LlmClient {
  systems: string[] = [];
  async *chat(messages: ChatMessage[]): AsyncGenerator<ChatChunk> {
    this.systems.push(messages[0]?.content ?? '');
    yield { type: 'token', text: 'Certo!' };
    yield { type: 'done', stats: {} };
  }
  async status(): Promise<LlmStatus> {
    return { state: 'ready', version: 't', model: 't' };
  }
}

async function say(session: ChatSession, text: string): Promise<void> {
  const stream = session.send(text);
  while (!(await stream.next()).done) {
    // só consome a resposta
  }
}

describe('formatMemoryPrompt', () => {
  it('lista os fatos do mais antigo ao mais novo, com data e aviso de assunto delicado', () => {
    const fact = (id: number, text: string, updatedAt: number, sensitive = false): Fact => ({
      id,
      text,
      sensitive,
      personaId: 'stella',
      createdAt: updatedAt,
      updatedAt,
    });
    const prompt = formatMemoryPrompt([
      fact(2, 'O usuário mora em São Paulo.', Date.UTC(2026, 10, 16, 12)),
      fact(1, 'O usuário mora em Curitiba.', Date.UTC(2026, 0, 5, 12)),
      fact(3, 'O usuário tem ansiedade.', Date.UTC(2026, 10, 16, 12), true),
    ]);
    expect(prompt).toBe(
      [
        'O que você lembra sobre o usuário, de conversas anteriores:',
        '- O usuário mora em Curitiba. (05/01/2026)',
        '- O usuário mora em São Paulo. (16/11/2026)',
        '- O usuário tem ansiedade. (16/11/2026) [assunto delicado: só comente se o usuário falar disso]',
        'Use essas lembranças com naturalidade, só quando ajudarem. Não liste tudo de uma vez.',
        'Se duas lembranças se contradizem, vale a mais recente.',
      ].join('\n'),
    );
    expect(formatMemoryPrompt([])).toBeUndefined();
  });
});

describe('Memory', () => {
  let dir: string;
  let path: string;
  let embedder: WordsEmbedder;
  const open = (topK = 5, onFactsAdded?: (f: Fact[]) => void) =>
    new Memory(new MemoryStore(path), embedder, new RuleExtractor(), {
      topK,
      log: () => {},
      ...(onFactsAdded ? { onFactsAdded } : {}),
    });

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'stella-memory-'));
    path = join(dir, 'memoria.db');
    embedder = new WordsEmbedder();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('um fato dito numa sessão é lembrado na seguinte; apagado, é esquecido', async () => {
    // Sessão 1: o usuário conta o nome.
    const first = open();
    await say(new ChatSession(new EchoLlm(), { memory: first }), 'Oi! Meu nome é Artur.');
    await first.whenIdle();
    first.store.close();

    // Sessão 2 (app reaberto): o nome vai no prompt.
    const second = open();
    const llm = new EchoLlm();
    await say(new ChatSession(llm, { memory: second }), 'Qual é o meu nome?');
    expect(llm.systems[0]).toContain('O usuário se chama Artur.');

    // O usuário apaga o fato na tela de memória.
    const [fact] = second.listFacts();
    expect(second.deleteFact(fact?.id ?? -1)).toBe(true);
    await second.whenIdle();
    second.store.close();

    // Sessão 3: esqueceu.
    const third = open();
    const llm3 = new EchoLlm();
    await say(new ChatSession(llm3, { memory: third }), 'Qual é o meu nome?');
    expect(llm3.systems[0]).not.toContain('Artur');
    expect(third.listFacts()).toEqual([]);
    third.store.close();
  });

  it('guarda o histórico da conversa no SQLite', async () => {
    const memory = open();
    const session = new ChatSession(new EchoLlm(), { memory });
    await say(session, 'Oi');
    await say(session, 'Tudo bem?');
    expect(memory.store.messageCount()).toBe(4);
    memory.newConversation();
    await say(session, 'Nova conversa');
    expect(memory.store.messages(2)).toEqual([
      { role: 'user', content: 'Nova conversa', personaId: 'stella' },
      { role: 'assistant', content: 'Certo!', personaId: 'stella' },
    ]);
    memory.store.close();
  });

  it('não guarda o mesmo fato duas vezes', async () => {
    const added: Fact[][] = [];
    const memory = open(5, (f) => added.push(f));
    memory.record({ user: 'Meu nome é Ana.', assistant: 'Oi' });
    memory.record({ user: 'meu nome é Ana!', assistant: 'Eu sei' });
    await memory.whenIdle();
    expect(memory.listFacts().map((f) => f.text)).toEqual(['O usuário se chama Ana.']);
    expect(added).toHaveLength(1);
    memory.store.close();
  });

  it('com muitos fatos, manda só os mais parecidos com a mensagem', async () => {
    const memory = open(2);
    memory.record({
      user: 'Eu gosto de café forte, gosto de futebol, gosto de gatos pretos, gosto de chuva.',
      assistant: 'Legal',
    });
    await memory.whenIdle();
    expect(memory.listFacts()).toHaveLength(4);

    const facts = await memory.relevantFacts('você lembra dos gatos pretos?');
    expect(facts).toHaveLength(2);
    expect(facts[0]?.text).toBe('O usuário gosta de gatos pretos.');
    memory.store.close();
  });

  it('com poucos fatos, manda todos sem calcular embedding', async () => {
    const memory = open(5);
    memory.record({ user: 'Meu nome é Ana.', assistant: 'Oi' });
    await memory.whenIdle();
    const before = embedder.calls;
    expect(await memory.relevantFacts('qualquer coisa')).toHaveLength(1);
    expect(embedder.calls).toBe(before);
    memory.store.close();
  });

  it('sem embeddings, ainda guarda fatos e lembra os mais recentes', async () => {
    embedder.failing = true;
    const memory = open(1);
    memory.record({ user: 'Meu nome é Ana. Eu gosto de chá.', assistant: 'Oi' });
    await memory.whenIdle();
    expect(memory.listFacts()).toHaveLength(2);
    expect(await memory.relevantFacts('oi')).toHaveLength(1);

    // Quando o embedding volta, warmUp indexa o que ficou sem vetor.
    embedder.failing = false;
    await memory.warmUp();
    expect(memory.store.factsWithoutEmbedding()).toEqual([]);
    memory.store.close();
  });

  it('marca fatos delicados', async () => {
    const memory = open();
    memory.record({ user: 'Meu médico disse que tenho ansiedade.', assistant: 'Entendo.' });
    await memory.whenIdle();
    expect(memory.listFacts()[0]).toMatchObject({
      text: 'O usuário tem ansiedade.',
      sensitive: true,
    });
    expect(await memory.recall('oi')).toContain('[assunto delicado');
    memory.store.close();
  });

  it('editar um fato muda o que é lembrado', async () => {
    const memory = open();
    memory.record({ user: 'Meu nome é Ana.', assistant: 'Oi' });
    await memory.whenIdle();
    const [fact] = memory.listFacts();
    await memory.updateFact(fact?.id ?? -1, '  O usuário   prefere ser chamado de Aninha. ');
    expect(await memory.recall('oi')).toContain('O usuário prefere ser chamado de Aninha.');
    await expect(memory.updateFact(fact?.id ?? -1, '   ')).rejects.toThrow(/vazio/);
    memory.store.close();
  });

  it('apagar tudo esquece fatos e, se pedido, o histórico', async () => {
    const memory = open();
    memory.record({ user: 'Meu nome é Ana.', assistant: 'Oi' });
    await memory.whenIdle();
    memory.clear();
    expect(memory.listFacts()).toEqual([]);
    expect(memory.store.messageCount()).toBe(2);
    memory.clear({ history: true });
    expect(memory.store.messageCount()).toBe(0);
    memory.store.close();
  });

  it('falha na extração não quebra nada', async () => {
    const memory = new Memory(
      new MemoryStore(path),
      embedder,
      new FactExtractor({
        complete: async () => {
          throw new LlmError('unavailable', 'fora do ar');
        },
      }),
      { log: () => {} },
    );
    memory.record({ user: 'Meu nome é Ana.', assistant: 'Oi' });
    await memory.whenIdle();
    expect(memory.listFacts()).toEqual([]);
    expect(memory.store.messageCount()).toBe(2);
    memory.store.close();
  });
});

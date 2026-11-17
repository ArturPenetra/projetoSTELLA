import { describe, expect, it } from 'vitest';
import { LlmError } from '../llm/errors.js';
import type { ChatChunk, ChatMessage, LlmClient, LlmStatus } from '../llm/types.js';
import { ChatSession, DEFAULT_SYSTEM_PROMPT, SpeakerTagFilter } from './session.js';

class ScriptedLlm implements LlmClient {
  calls: ChatMessage[][] = [];
  constructor(private readonly replies: (string[] | Error)[]) {}

  async *chat(messages: ChatMessage[]): AsyncGenerator<ChatChunk> {
    this.calls.push(messages);
    const next = this.replies.shift() ?? ['ok'];
    if (next instanceof Error) throw next;
    for (const text of next) yield { type: 'token', text };
    yield { type: 'done', stats: {} };
  }

  async status(): Promise<LlmStatus> {
    return { state: 'ready', version: 'teste', model: 'teste' };
  }
}

async function drain(stream: AsyncIterable<ChatChunk>): Promise<string> {
  let text = '';
  for await (const c of stream) if (c.type === 'token') text += c.text;
  return text;
}

describe('ChatSession', () => {
  it('manda o prompt de sistema e guarda a troca no histórico', async () => {
    const llm = new ScriptedLlm([['Oi', '!']]);
    const session = new ChatSession(llm);

    expect(await drain(session.send('  Olá  '))).toBe('Oi!');
    expect(llm.calls[0]?.[0]).toEqual({ role: 'system', content: DEFAULT_SYSTEM_PROMPT });
    expect(session.messages).toEqual([
      { role: 'user', content: 'Olá' },
      { role: 'assistant', content: 'Oi!', speakerId: 'stella', speakerName: 'Stella' },
    ]);
  });

  it('inclui o histórico nas mensagens seguintes', async () => {
    const llm = new ScriptedLlm([['A'], ['B']]);
    const session = new ChatSession(llm);
    await drain(session.send('primeira'));
    await drain(session.send('segunda'));
    expect(llm.calls[1]?.map((m) => m.content)).toEqual([
      DEFAULT_SYSTEM_PROMPT,
      'primeira',
      'A',
      'segunda',
    ]);
  });

  it('limita o histórico enviado', async () => {
    const llm = new ScriptedLlm([['1'], ['2'], ['3']]);
    const session = new ChatSession(llm, { maxHistory: 2 });
    await drain(session.send('a'));
    await drain(session.send('b'));
    await drain(session.send('c'));
    expect(llm.calls[2]?.map((m) => m.content)).toEqual([DEFAULT_SYSTEM_PROMPT, 'b', '2', 'c']);
  });

  it('não guarda a troca quando a resposta falha, e libera para tentar de novo', async () => {
    const llm = new ScriptedLlm([LlmError.unavailable('http://127.0.0.1:11434'), ['voltei']]);
    const session = new ChatSession(llm);

    await expect(drain(session.send('oi'))).rejects.toThrow(LlmError);
    expect(session.messages).toEqual([]);
    expect(session.isBusy).toBe(false);

    expect(await drain(session.send('oi'))).toBe('voltei');
    expect(session.messages).toHaveLength(2);
  });

  it('recusa mensagem vazia', async () => {
    const session = new ChatSession(new ScriptedLlm([]));
    await expect(drain(session.send('   '))).rejects.toThrow(/vazia/);
  });

  describe('com memória', () => {
    class FakeMemory {
      recorded: { user: string; assistant: string; previousAssistant?: string }[] = [];
      constructor(private readonly text: string | undefined) {}
      async recall() {
        return this.text;
      }
      record(e: { user: string; assistant: string; previousAssistant?: string }) {
        this.recorded.push(e);
      }
    }

    it('põe as lembranças no prompt de sistema', async () => {
      const llm = new ScriptedLlm([['Oi, Ana!']]);
      const memory = new FakeMemory('- O usuário se chama Ana.');
      const session = new ChatSession(llm, { memory });
      await drain(session.send('Oi'));
      expect(llm.calls[0]?.[0]).toEqual({
        role: 'system',
        content: `${DEFAULT_SYSTEM_PROMPT}

- O usuário se chama Ana.`,
      });
    });

    it('sem lembranças, o prompt fica igual', async () => {
      const llm = new ScriptedLlm([['Oi']]);
      await drain(new ChatSession(llm, { memory: new FakeMemory(undefined) }).send('Oi'));
      expect(llm.calls[0]?.[0]?.content).toBe(DEFAULT_SYSTEM_PROMPT);
    });

    it('guarda cada troca com a fala anterior da companheira', async () => {
      const memory = new FakeMemory(undefined);
      const session = new ChatSession(new ScriptedLlm([['Qual é o seu nome?'], ['Prazer, Ana!']]), {
        memory,
      });
      await drain(session.send('Oi'));
      await drain(session.send('Ana'));
      expect(memory.recorded).toEqual([
        { user: 'Oi', assistant: 'Qual é o seu nome?', personaId: 'stella' },
        {
          user: 'Ana',
          assistant: 'Prazer, Ana!',
          personaId: 'stella',
          previousAssistant: 'Qual é o seu nome?',
        },
      ]);
    });

    it('não guarda resposta que falhou, e erro ao guardar não estraga a resposta', async () => {
      const memory = new FakeMemory(undefined);
      memory.record = () => {
        throw new Error('disco cheio');
      };
      const session = new ChatSession(
        new ScriptedLlm([new LlmError('unavailable', 'fora do ar'), ['Oi!']]),
        { memory },
      );
      await expect(drain(session.send('Oi'))).rejects.toThrow('fora do ar');
      expect(await drain(session.send('Oi'))).toBe('Oi!');
    });
  });

  describe('com personas', () => {
    const leo = { id: 'leo', name: 'Leo', systemPrompt: 'Você é o Leo.' };
    const corni = { id: 'corni', name: 'Corni', systemPrompt: 'Você é a Corni.' };

    it('ao trocar, a nova persona vê as falas da anterior com o nome dela', async () => {
      const llm = new ScriptedLlm([['Bora treinar!'], ['Vamos organizar.']]);
      const session = new ChatSession(llm, { speaker: leo });
      await drain(session.send('Quero treinar'));
      session.setSpeaker(corni);
      await drain(session.send('E agora?'));

      // A conversa com o Leo vira transcrição no prompt de sistema: a Corni não vê falas de
      // assistente de outra persona (o modelo pequeno passava a repeti-las).
      expect(llm.calls[1]).toEqual([
        {
          role: 'system',
          content: [
            'Você é a Corni.',
            '',
            'Conversa até agora, antes de você responder (falas com o nome de outra persona são dela, não suas; não as repita):',
            'Usuário: Quero treinar',
            'Leo: Bora treinar!',
          ].join('\n'),
        },
        { role: 'user', content: 'E agora?' },
      ]);
    });

    it('as próprias falas vão sem rótulo', async () => {
      const llm = new ScriptedLlm([['Um'], ['Dois']]);
      const session = new ChatSession(llm, { speaker: leo });
      await drain(session.send('a'));
      await drain(session.send('b'));
      expect(llm.calls[1]?.[2]).toEqual({ role: 'assistant', content: 'Um' });
    });

    it('instrução oculta não entra no histórico nem na memória; a resposta entra', async () => {
      const recorded: unknown[] = [];
      const recalled: (string | undefined)[][] = [];
      const memory = {
        recall: async (text: string, _signal?: AbortSignal, personaId?: string) => {
          recalled.push([text, personaId]);
          return undefined;
        },
        record: (e: unknown) => recorded.push(e),
      };
      const llm = new ScriptedLlm([['Bora!'], ['Oi, aqui é a Corni.']]);
      const session = new ChatSession(llm, { speaker: leo, memory });
      await drain(session.send('Quero treinar'));
      session.setSpeaker(corni);
      await drain(session.send('(instrução do app)', { hidden: true }));

      expect(llm.calls[1]?.at(-1)).toEqual({ role: 'user', content: '(instrução do app)' });
      expect(session.messages.map((m) => m.content)).toEqual([
        'Quero treinar',
        'Bora!',
        'Oi, aqui é a Corni.',
      ]);
      expect(session.messages.at(-1)?.speakerId).toBe('corni');
      expect(recorded).toHaveLength(1);
      // A busca na memória usa a última mensagem real do usuário, para a persona nova.
      expect(recalled).toEqual([
        ['Quero treinar', 'leo'],
        ['Quero treinar', 'corni'],
      ]);
    });
  });

  it('nota da persona vai junto da mensagem para o modelo, mas não fica no histórico', async () => {
    const llm = new ScriptedLlm([['Oi'], ['Tudo']]);
    const session = new ChatSession(llm, {
      speaker: {
        id: 'p',
        name: 'P',
        systemPrompt: 'S',
        turnNote: (t) => (t.includes('signo') ? '(nota)' : undefined),
      },
    });
    await drain(session.send('Qual meu signo?'));
    await drain(session.send('Oi'));
    expect(llm.calls[0]?.at(-1)).toEqual({ role: 'user', content: 'Qual meu signo?\n\n(nota)' });
    expect(llm.calls[1]?.[1]).toEqual({ role: 'user', content: 'Qual meu signo?' });
    expect(llm.calls[1]?.at(-1)).toEqual({ role: 'user', content: 'Oi' });
  });
});

describe('SpeakerTagFilter', () => {
  const run = (pieces: string[]) => {
    const f = new SpeakerTagFilter();
    return pieces.map((p) => f.push(p)).join('') + f.flush();
  };

  it('tira o rótulo copiado do histórico, mesmo chegando em pedaços', () => {
    expect(run(['[Leo] Artur, bom dia!'])).toBe('Artur, bom dia!');
    expect(run(['[', 'Le', 'o]', ' ', 'Oi!'])).toBe('Oi!');
    expect(run(['  [Corni]   ', 'Foco.'])).toBe('Foco.');
  });

  it('não mexe no resto do texto', () => {
    expect(run(['Oi', ' [Leo] tudo bem?'])).toBe('Oi [Leo] tudo bem?');
    expect(run(['[nota de rodapé muito longa que não é rótulo nenhum] texto'])).toBe(
      '[nota de rodapé muito longa que não é rótulo nenhum] texto',
    );
    expect(run(['[sem fechar'])).toBe('[sem fechar');
  });

  it('resposta só com o rótulo vira vazia', () => {
    expect(run(['[Leo] '])).toBe('');
  });

  it('na sessão, nem o streaming nem o histórico guardam o rótulo', async () => {
    const llm = new ScriptedLlm([['[Leo', '] Bora', '!']]);
    const session = new ChatSession(llm);
    expect(await drain(session.send('Oi'))).toBe('Bora!');
    expect(session.messages.at(-1)?.content).toBe('Bora!');
  });
});

describe('estabilidade nas trocas de persona', () => {
  const names = ['Leo', 'Aqua'];

  it('o filtro também tira "Nome:" de personas conhecidas', () => {
    const run = (pieces: string[]) => {
      const f = new SpeakerTagFilter(names);
      return pieces.map((p) => f.push(p)).join('') + f.flush();
    };
    expect(run(['Aqua: Oi Artur!'])).toBe('Oi Artur!');
    expect(run(['A', 'qu', 'a', ':', ' Oi'])).toBe('Oi');
    expect(run(['Aquário é um signo'])).toBe('Aquário é um signo');
    expect(run(['Leonardo: oi'])).toBe('Leonardo: oi');
    expect(run(['Ana: oi'])).toBe('Ana: oi');
  });

  it('dropPendingHandoffs tira só as falas por conta própria sem resposta', async () => {
    const llm = new ScriptedLlm([['Resposta'], ['Troca 1'], ['Troca 2']]);
    const session = new ChatSession(llm);
    session.say('Cumprimento');
    expect(session.hasUserMessages).toBe(false);
    expect(session.dropPendingHandoffs()).toBe(1);
    await drain(session.send('Oi'));
    await drain(session.send('(troca)', { hidden: true }));
    await drain(session.send('(troca)', { hidden: true }));
    expect(session.messages.map((m) => [m.content, m.handoff ?? false])).toEqual([
      ['Oi', false],
      ['Resposta', false],
      ['Troca 1', true],
      ['Troca 2', true],
    ]);
    expect(session.dropPendingHandoffs()).toBe(2);
    expect(session.messages.map((m) => m.content)).toEqual(['Oi', 'Resposta']);
    expect(session.recentUserMessages()).toEqual(['Oi']);
  });
});

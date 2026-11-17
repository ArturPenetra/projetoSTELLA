import { describe, expect, it } from 'vitest';
import { LlmError } from '../llm/errors.js';
import type { ChatChunk, ChatMessage, LlmClient, LlmStatus } from '../llm/types.js';
import { ChatSession, DEFAULT_SYSTEM_PROMPT } from './session.js';

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
      { role: 'assistant', content: 'Oi!' },
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
        { user: 'Oi', assistant: 'Qual é o seu nome?' },
        { user: 'Ana', assistant: 'Prazer, Ana!', previousAssistant: 'Qual é o seu nome?' },
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
});

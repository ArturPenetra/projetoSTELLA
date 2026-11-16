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
});

import { describe, expect, it } from 'vitest';
import type { ChatMessage, CompleteOptions, Completer } from '../llm/types.js';
import { EXTRACTION_PROMPT, FACTS_JSON_SCHEMA, FactExtractor, parseFacts } from './extractor.js';

class FakeCompleter implements Completer {
  calls: { messages: ChatMessage[]; options: CompleteOptions }[] = [];
  constructor(private readonly reply: string) {}
  async complete(messages: ChatMessage[], options: CompleteOptions = {}): Promise<string> {
    this.calls.push({ messages, options });
    return this.reply;
  }
}

describe('FactExtractor', () => {
  it('pede JSON com esquema, temperatura 0 e só a mensagem do usuário', async () => {
    const llm = new FakeCompleter(
      '{"facts":[{"text":"O usuário se chama Ana.","sensitive":false}]}',
    );
    const facts = await new FactExtractor(llm).extract({ user: ' Meu nome é Ana ' });
    expect(facts).toEqual([{ text: 'O usuário se chama Ana.', sensitive: false }]);
    expect(llm.calls[0]).toEqual({
      messages: [
        { role: 'system', content: EXTRACTION_PROMPT },
        { role: 'user', content: 'Mensagem do usuário:\nMeu nome é Ana' },
      ],
      options: { format: FACTS_JSON_SCHEMA, temperature: 0 },
    });
  });

  it('inclui a fala anterior da companheira para dar contexto', async () => {
    const llm = new FakeCompleter('{"facts":[]}');
    await new FactExtractor(llm).extract({ user: 'Ana', previousAssistant: 'Como você se chama?' });
    expect(llm.calls[0]?.messages[1]?.content).toBe(
      'A assistente tinha dito:\nComo você se chama?\n\nMensagem do usuário:\nAna',
    );
  });

  it('mensagem vazia nem chama o modelo', async () => {
    const llm = new FakeCompleter('{"facts":[]}');
    expect(await new FactExtractor(llm).extract({ user: '   ' })).toEqual([]);
    expect(llm.calls).toHaveLength(0);
  });
});

describe('parseFacts', () => {
  it('ignora respostas que não são o JSON esperado', () => {
    expect(parseFacts('não é json')).toEqual([]);
    expect(parseFacts('{"fatos":[]}')).toEqual([]);
    expect(parseFacts('[]')).toEqual([]);
  });

  it('limpa espaços, tira repetidos, curtos demais e longos demais', () => {
    const raw = JSON.stringify({
      facts: [
        { text: '  O usuário   mora em Curitiba. ', sensitive: false },
        { text: 'o usuário mora em curitiba.', sensitive: false },
        { text: 'curto', sensitive: false },
        { text: 'x'.repeat(201), sensitive: false },
        { text: 'O usuário tem ansiedade.', sensitive: true },
      ],
    });
    expect(parseFacts(raw)).toEqual([
      { text: 'O usuário mora em Curitiba.', sensitive: false },
      { text: 'O usuário tem ansiedade.', sensitive: true },
    ]);
  });

  it('sensitive inválido vira false e campos extras são ignorados', () => {
    const raw = '{"facts":[{"text":"O usuário gosta de chá.","sensitive":"sim","x":1}]}';
    expect(parseFacts(raw)).toEqual([{ text: 'O usuário gosta de chá.', sensitive: false }]);
  });

  it('aproveita no máximo 5 fatos por mensagem', () => {
    const facts = Array.from({ length: 9 }, (_, i) => ({
      text: `O usuário fato ${i}.`,
      sensitive: false,
    }));
    expect(parseFacts(JSON.stringify({ facts }))).toHaveLength(5);
  });
});

import { z } from 'zod';
import type { Completer } from '../llm/types.js';

export interface ExtractedFact {
  text: string;
  sensitive: boolean;
}

export interface ExchangeToExtract {
  /** O que o usuário escreveu. */
  user: string;
  /** O que a companheira tinha dito antes (dá sentido a respostas curtas como "Ana"). */
  previousAssistant?: string | undefined;
}

/** Máximo de fatos aproveitados por mensagem: mais que isso é sinal de que o modelo inventou. */
export const MAX_FACTS_PER_MESSAGE = 5;
const MAX_FACT_LENGTH = 200;

/** Esquema da saída estruturada pedida ao Ollama. */
export const FACTS_JSON_SCHEMA = {
  type: 'object',
  properties: {
    facts: {
      type: 'array',
      items: {
        type: 'object',
        properties: { text: { type: 'string' }, sensitive: { type: 'boolean' } },
        required: ['text', 'sensitive'],
      },
    },
  },
  required: ['facts'],
} as const;

const responseSchema = z.object({
  facts: z.array(z.object({ text: z.string(), sensitive: z.boolean().catch(false) }).loose()),
});

// Testado com o qwen3.5:2b: pegar só a mensagem do usuário funciona bem. Mostrar ao modelo
// os fatos já salvos (para ele apontar correções) piorou: ele passou a repetir a lista.
export const EXTRACTION_PROMPT = `Você extrai fatos duradouros sobre o USUÁRIO a partir da última mensagem dele.
Regras:
- Só fatos que continuarão verdadeiros e úteis em conversas futuras: nome, como prefere ser chamado, idade, onde mora, trabalho, estudos, rotina, gostos, metas, pessoas e animais importantes.
- Escreva cada fato como uma frase curta em terceira pessoa começando por "O usuário" (ex.: "O usuário se chama Ana.").
- Ignore perguntas, cumprimentos, pedidos de ajuda pontuais e qualquer coisa dita pela assistente. A fala da assistente serve só para entender a resposta do usuário.
- Não invente nem deduza. Se não houver fato novo, devolva uma lista vazia.
- sensitive = true para saúde, relacionamentos amorosos, dinheiro, religião ou política.
Responda só com o JSON.`;

function cleanFact(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Usa o LLM local para tirar fatos sobre o usuário de cada mensagem. */
export class FactExtractor {
  constructor(private readonly llm: Completer) {}

  async extract(exchange: ExchangeToExtract, signal?: AbortSignal): Promise<ExtractedFact[]> {
    const user = exchange.user.trim();
    if (!user) return [];
    const context = exchange.previousAssistant?.trim()
      ? `A assistente tinha dito:\n${exchange.previousAssistant.trim()}\n\n`
      : '';
    const raw = await this.llm.complete(
      [
        { role: 'system', content: EXTRACTION_PROMPT },
        { role: 'user', content: `${context}Mensagem do usuário:\n${user}` },
      ],
      { format: FACTS_JSON_SCHEMA, temperature: 0, ...(signal ? { signal } : {}) },
    );
    return parseFacts(raw);
  }
}

/** Valida a resposta do modelo. Lixo vira lista vazia: errar para menos é mais seguro. */
export function parseFacts(raw: string): ExtractedFact[] {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return [];
  }
  const parsed = responseSchema.safeParse(json);
  if (!parsed.success) return [];

  const seen = new Set<string>();
  const facts: ExtractedFact[] = [];
  for (const f of parsed.data.facts) {
    const text = cleanFact(f.text);
    const key = text.toLowerCase();
    if (text.length < 8 || text.length > MAX_FACT_LENGTH || seen.has(key)) continue;
    seen.add(key);
    facts.push({ text, sensitive: f.sensitive });
  }
  return facts.slice(0, MAX_FACTS_PER_MESSAGE);
}

import type { ChatChunk, ChatMessage, LlmClient } from '../llm/types.js';

/** Prompt provisório até o sistema de personas (Fase 5). */
export const DEFAULT_SYSTEM_PROMPT = [
  'Você é a Stella, uma companheira de IA que roda no computador do usuário, sem internet.',
  'Responda em português do Brasil, de forma calorosa, clara e breve.',
  'Se não souber algo, diga que não sabe.',
].join(' ');

export interface ChatSessionOptions {
  systemPrompt?: string;
  /** Quantas mensagens recentes (usuário + assistente) mandar ao modelo. */
  maxHistory?: number;
}

/** Uma conversa em andamento: guarda o histórico e conversa com o LLM. */
export class ChatSession {
  private readonly history: ChatMessage[] = [];
  private readonly systemPrompt: string;
  private readonly maxHistory: number;
  private busy = false;

  constructor(
    private readonly llm: LlmClient,
    options: ChatSessionOptions = {},
  ) {
    this.systemPrompt = options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
    this.maxHistory = options.maxHistory ?? 20;
  }

  get messages(): readonly ChatMessage[] {
    return this.history;
  }

  get isBusy(): boolean {
    return this.busy;
  }

  /**
   * Envia uma mensagem e devolve a resposta em streaming.
   * A troca só entra no histórico se a resposta chegar inteira.
   */
  async *send(text: string, signal?: AbortSignal): AsyncGenerator<ChatChunk> {
    const content = text.trim();
    if (!content) throw new Error('Mensagem vazia.');
    if (this.busy) throw new Error('Já existe uma resposta em andamento.');
    this.busy = true;

    const userMessage: ChatMessage = { role: 'user', content };
    const context: ChatMessage[] = [
      { role: 'system', content: this.systemPrompt },
      ...this.history.slice(-this.maxHistory),
      userMessage,
    ];

    let reply = '';
    try {
      for await (const chunk of this.llm.chat(context, signal ? { signal } : {})) {
        if (chunk.type === 'token') reply += chunk.text;
        yield chunk;
        if (chunk.type === 'done') {
          this.history.push(userMessage, { role: 'assistant', content: reply });
        }
      }
    } finally {
      this.busy = false;
    }
  }

  clear(): void {
    this.history.length = 0;
  }
}

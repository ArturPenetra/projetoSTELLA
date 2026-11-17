import type { ChatChunk, ChatMessage, LlmClient } from '../llm/types.js';
import type { ConversationMemory } from '../memory/memory.js';

/** Prompt provisório até o sistema de personas (Fase 5). */
export const DEFAULT_SYSTEM_PROMPT = [
  'Você é a Stella, uma companheira de IA que roda no computador do usuário, sem internet.',
  'Responda em português do Brasil, de forma calorosa, clara e breve.',
  'Se não souber algo, diga que não sabe.',
  // Medido com o qwen3.5:2b: sem esta regra ele confunde "meu nome" com o nome dele e inventa
  // nomes e cidades; com ela, passa a admitir que não sabe com bem mais frequência.
  'O usuário é a pessoa que conversa com você; quando ele diz "eu", "meu" ou "minha", fala dele mesmo, não de você.',
  'Nunca invente nada sobre ele: você só sabe o que ele contou nesta conversa ou o que está nas suas lembranças. Se não souber, diga que ainda não sabe e pergunte.',
  'Escreva em texto simples, sem Markdown (nada de asteriscos, # ou listas com marcadores).',
].join(' ');

export interface ChatSessionOptions {
  systemPrompt?: string;
  /** Quantas mensagens recentes (usuário + assistente) mandar ao modelo. */
  maxHistory?: number;
  /** Memória de longo prazo: lembranças entram no prompt e cada troca é guardada. */
  memory?: ConversationMemory;
}

/** Uma conversa em andamento: guarda o histórico e conversa com o LLM. */
export class ChatSession {
  private readonly history: ChatMessage[] = [];
  private readonly systemPrompt: string;
  private readonly maxHistory: number;
  private readonly memory: ConversationMemory | undefined;
  private busy = false;

  constructor(
    private readonly llm: LlmClient,
    options: ChatSessionOptions = {},
  ) {
    this.systemPrompt = options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
    this.maxHistory = options.maxHistory ?? 20;
    this.memory = options.memory;
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

    let reply = '';
    try {
      const userMessage: ChatMessage = { role: 'user', content };
      const remembered = await this.memory?.recall(content, signal);
      const system = remembered ? `${this.systemPrompt}\n\n${remembered}` : this.systemPrompt;
      const context: ChatMessage[] = [
        { role: 'system', content: system },
        ...this.history.slice(-this.maxHistory),
        userMessage,
      ];
      const previousAssistant = this.history.findLast((m) => m.role === 'assistant')?.content;

      for await (const chunk of this.llm.chat(context, signal ? { signal } : {})) {
        if (chunk.type === 'token') reply += chunk.text;
        yield chunk;
        if (chunk.type === 'done') {
          this.history.push(userMessage, { role: 'assistant', content: reply });
          this.remember(content, reply, previousAssistant);
        }
      }
    } finally {
      this.busy = false;
    }
  }

  private remember(user: string, assistant: string, previousAssistant?: string): void {
    if (!this.memory) return;
    try {
      this.memory.record({ user, assistant, ...(previousAssistant ? { previousAssistant } : {}) });
    } catch (err) {
      // Falha ao guardar não pode estragar uma resposta que já chegou inteira.
      console.warn('[memória] não consegui guardar a conversa', err);
    }
  }

  clear(): void {
    this.history.length = 0;
  }
}

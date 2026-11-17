export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

/** Pedido do modelo para usar uma ferramenta (os argumentos ainda não foram validados). */
export interface ToolCall {
  name: string;
  arguments: unknown;
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** Na fala do assistente: as ferramentas que ele pediu. */
  toolCalls?: ToolCall[];
  /** Na mensagem `tool`: qual ferramenta respondeu. */
  toolName?: string;
}

/** Ferramenta oferecida ao modelo (formato de função com esquema JSON, como o Ollama espera). */
export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** Um pedaço da resposta em streaming. */
export type ChatChunk =
  | { type: 'token'; text: string }
  | { type: 'tool_calls'; calls: ToolCall[] }
  /** Uso de ferramenta pela sessão (para o indicador "agindo" na tela). */
  | {
      type: 'tool';
      status: 'start' | 'end';
      name: string;
      summary?: string;
      decision?: string;
    }
  | { type: 'done'; stats: ChatStats };

export interface ChatStats {
  /** Tokens gerados na resposta. */
  outputTokens?: number;
  /** Tempo total em milissegundos, segundo o servidor. */
  totalMs?: number;
}

export interface ChatOptions {
  signal?: AbortSignal;
  /** Ferramentas que o modelo pode pedir nesta resposta (só as que o usuário ligou). */
  tools?: ToolSpec[];
}

export type LlmStatus =
  | { state: 'ready'; version: string; model: string }
  | { state: 'model_missing'; version: string; model: string }
  | { state: 'unavailable'; message: string };

export interface LlmClient {
  /** Envia a conversa e devolve a resposta em pedaços, à medida que é gerada. */
  chat(messages: ChatMessage[], options?: ChatOptions): AsyncIterable<ChatChunk>;
  /** Confere se o servidor está no ar e se o modelo está instalado. */
  status(): Promise<LlmStatus>;
}

export interface CompleteOptions {
  signal?: AbortSignal;
  /** Esquema JSON que a resposta deve seguir (saída estruturada do Ollama). */
  format?: Record<string, unknown>;
  temperature?: number;
}

/** Resposta única, sem streaming (usada em tarefas internas, como extrair fatos). */
export interface Completer {
  complete(messages: ChatMessage[], options?: CompleteOptions): Promise<string>;
}

/** Transforma textos em vetores (embeddings) para busca por similaridade. */
export interface Embedder {
  readonly model: string;
  embed(texts: string[], signal?: AbortSignal): Promise<Float32Array[]>;
}

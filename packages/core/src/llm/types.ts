export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

/** Um pedaço da resposta em streaming. */
export type ChatChunk = { type: 'token'; text: string } | { type: 'done'; stats: ChatStats };

export interface ChatStats {
  /** Tokens gerados na resposta. */
  outputTokens?: number;
  /** Tempo total em milissegundos, segundo o servidor. */
  totalMs?: number;
}

export interface ChatOptions {
  signal?: AbortSignal;
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

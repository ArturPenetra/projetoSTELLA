import type { LlmErrorCode, LlmStatus } from '@stella/core';

/** Nomes dos canais IPC. O renderer só fala com o processo principal por eles. */
export const IPC = {
  llmStatus: 'llm:status',
  chatSend: 'chat:send',
  chatCancel: 'chat:cancel',
  chatReset: 'chat:reset',
  chatEvent: 'chat:event',
} as const;

export const MAX_MESSAGE_LENGTH = 8000;

export type ChatEvent =
  | { requestId: string; type: 'token'; text: string }
  | { requestId: string; type: 'done'; outputTokens?: number; totalMs?: number }
  | { requestId: string; type: 'error'; code: LlmErrorCode | 'internal'; message: string };

export interface StellaApi {
  appName: string;
  versions: { electron: string; chrome: string; node: string };
  llm: {
    status(): Promise<LlmStatus>;
  };
  chat: {
    /** Envia a mensagem; a resposta chega por onEvent com o mesmo requestId. */
    send(text: string): Promise<{ requestId: string }>;
    cancel(requestId: string): Promise<void>;
    reset(): Promise<void>;
    onEvent(listener: (event: ChatEvent) => void): () => void;
  };
}

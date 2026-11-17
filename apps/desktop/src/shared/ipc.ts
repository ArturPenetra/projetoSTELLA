import type { AvatarSnapshot, LlmErrorCode, LlmStatus } from '@stella/core';

/** Nomes dos canais IPC. O renderer só fala com o processo principal por eles. */
export const IPC = {
  llmStatus: 'llm:status',
  chatSend: 'chat:send',
  chatCancel: 'chat:cancel',
  chatReset: 'chat:reset',
  chatEvent: 'chat:event',
  memoryStatus: 'memory:status',
  memoryList: 'memory:list',
  memoryUpdate: 'memory:update',
  memoryDelete: 'memory:delete',
  memoryClear: 'memory:clear',
  memoryEvent: 'memory:event',
  avatarState: 'avatar:state',
  avatarGet: 'avatar:get',
  companionInteractive: 'companion:interactive',
  companionDragStart: 'companion:drag-start',
  companionDragMove: 'companion:drag-move',
  companionDragEnd: 'companion:drag-end',
  companionOpenChat: 'companion:open-chat',
  companionMenu: 'companion:menu',
} as const;

export const MAX_MESSAGE_LENGTH = 8000;

export type ChatEvent =
  | { requestId: string; type: 'token'; text: string }
  | { requestId: string; type: 'done'; outputTokens?: number; totalMs?: number }
  | { requestId: string; type: 'error'; code: LlmErrorCode | 'internal'; message: string };

/** Um fato como a tela de memória mostra. */
export interface FactView {
  id: number;
  text: string;
  sensitive: boolean;
  createdAt: number;
  updatedAt: number;
}

export type MemoryStatus =
  { enabled: true; factCount: number } | { enabled: false; reason: string };

export type MemoryEvent = { type: 'added'; facts: FactView[] };

export const MAX_FACT_LENGTH = 300;

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
  memory: {
    status(): Promise<MemoryStatus>;
    list(): Promise<FactView[]>;
    update(id: number, text: string): Promise<FactView>;
    delete(id: number): Promise<void>;
    /** Esquece todos os fatos; com `history`, apaga também as conversas guardadas. */
    clear(options: { history: boolean }): Promise<void>;
    /** Avisa quando a Stella guarda fatos novos. */
    onEvent(listener: (event: MemoryEvent) => void): () => void;
  };
}

/** API da janela da companheira (avatar). Não tem acesso ao chat nem ao Ollama. */
export interface CompanionApi {
  /** Recebe o estado do avatar; chamado logo de início com o estado atual. */
  onState(listener: (state: AvatarSnapshot) => void): () => void;
  /** Avisa se o mouse está sobre o avatar (fora dele, os cliques atravessam a janela). */
  setInteractive(interactive: boolean): void;
  dragStart(): void;
  /** Deslocamento total, em pixels de tela, desde o início do arraste. */
  dragMove(dx: number, dy: number): void;
  dragEnd(): void;
  openChat(): void;
  openMenu(): void;
}

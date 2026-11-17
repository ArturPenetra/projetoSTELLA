import type {
  AvatarSnapshot,
  ElementId,
  LlmErrorCode,
  LlmStatus,
  Preference,
  SignId,
} from '@stella/core';

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
  personaState: 'persona:state',
  personaSelect: 'persona:select',
  personaSuggest: 'persona:suggest',
  personaSignsForDate: 'persona:signs-for-date',
  personaFinishOnboarding: 'persona:finish-onboarding',
  personaChanged: 'persona:changed',
  toolsState: 'tools:state',
  toolsSetEnabled: 'tools:set-enabled',
  toolsAddFolder: 'tools:add-folder',
  toolsRemoveFolder: 'tools:remove-folder',
  toolsAddApp: 'tools:add-app',
  toolsRemoveApp: 'tools:remove-app',
  toolsLog: 'tools:log',
  toolsConfirm: 'tools:confirm',
  toolsConfirmDismiss: 'tools:confirm-dismiss',
  toolsConfirmReply: 'tools:confirm-reply',
  avatarState: 'avatar:state',
  avatarGet: 'avatar:get',
  companionPersona: 'companion:persona',
  companionPersonaGet: 'companion:persona-get',
  companionInteractive: 'companion:interactive',
  companionDragStart: 'companion:drag-start',
  companionDragMove: 'companion:drag-move',
  companionDragEnd: 'companion:drag-end',
  companionOpenChat: 'companion:open-chat',
  companionBubbleClick: 'companion:bubble-click',
  companionMenu: 'companion:menu',
} as const;

export const MAX_MESSAGE_LENGTH = 8000;

/** Quem está respondendo (aparece acima de cada fala da companheira). */
export interface SpeakerView {
  id: string;
  name: string;
  element: ElementId;
}

export type ChatEvent =
  /**
   * Começo de uma resposta. `handoff`: a persona fala por conta própria (cumprimento ou troca);
   * se for cancelada ou substituída por outra troca, sai da tela.
   */
  | { requestId: string; type: 'start'; kind: 'reply' | 'handoff'; speaker: SpeakerView }
  /** Uma fala por conta própria foi substituída (trocas seguidas): some da tela. */
  | { requestId: string; type: 'retract' }
  /** Uso de ferramenta: começo (indicador "agindo") e fim (com o que aconteceu). */
  | {
      requestId: string;
      type: 'tool';
      status: 'start' | 'end';
      name: string;
      summary?: string;
      decision?: string;
    }
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

/** Cores de um elemento (config/elements.json). */
export interface Palette {
  primaria: string;
  secundaria: string;
  profunda: string;
  brilho: string;
}

export interface PersonaView {
  id: string;
  name: string;
  element: ElementId;
  status: 'active' | 'planned';
  gender: 'feminine' | 'masculine';
  role: string;
  coreTrait: string;
  greeting: string;
  sign: SignId;
  signName: string;
  palette: Palette;
}

export interface PersonaState {
  current: PersonaView;
  /** As 12, na ordem do zodíaco; as futuras com status "planned". */
  personas: PersonaView[];
  onboarded: boolean;
  sign: SignId | null;
  preference: Preference | null;
  signs: { id: SignId; name: string }[];
}

export interface SuggestionView {
  persona: PersonaView;
  ideal: PersonaView;
  standIn: boolean;
  reason: string;
}

export interface FinishOnboarding {
  personaId: string;
  sign: SignId | null;
  preference: Preference | null;
}

export interface AppView {
  name: string;
  path: string;
}

export interface ToolsState {
  enabled: { open_app: boolean; read_file: boolean };
  folders: string[];
  apps: AppView[];
}

export interface ToolLogView {
  at: number;
  tool: string;
  action: string;
  decision: string;
  detail: string;
}

/** Pedido de confirmação mostrado no chat, com a ação escrita por extenso. */
export interface ConfirmPrompt {
  id: string;
  persona: string;
  action: string;
  /** Aviso de possível injeção (o pedido veio depois de ler um arquivo). */
  warning: string | undefined;
  timeoutMs: number;
}

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
  personas: {
    state(): Promise<PersonaState>;
    /** Troca a persona (só ativas). A nova cumprimenta e retoma o assunto. */
    select(id: string): Promise<void>;
    suggest(sign: SignId, preference: Preference): Promise<SuggestionView>;
    /** Signo pela data (dia e mês). Dois signos quando a data cai no limite. */
    signsForDate(day: number, month: number): Promise<SignId[]>;
    finishOnboarding(choice: FinishOnboarding): Promise<void>;
    onChanged(listener: (persona: PersonaView) => void): () => void;
  };
  tools: {
    state(): Promise<ToolsState>;
    setEnabled(tool: 'open_app' | 'read_file', enabled: boolean): Promise<ToolsState>;
    /** Abre o diálogo do sistema para escolher uma pasta (o renderer nunca manda caminhos). */
    addFolder(): Promise<ToolsState>;
    removeFolder(path: string): Promise<ToolsState>;
    /** Abre o diálogo do sistema para escolher um programa (.exe). */
    addApp(): Promise<ToolsState>;
    removeApp(name: string): Promise<ToolsState>;
    log(): Promise<ToolLogView[]>;
    onConfirm(listener: (prompt: ConfirmPrompt) => void): () => void;
    onConfirmDismiss(listener: (id: string) => void): () => void;
    reply(id: string, allow: boolean): Promise<void>;
  };
}

/** API da janela da companheira (avatar). Não tem acesso ao chat nem ao Ollama. */
export interface CompanionApi {
  /** Recebe o estado do avatar; chamado logo de início com o estado atual. */
  onState(listener: (state: AvatarSnapshot) => void): () => void;
  /** Nome e elemento da persona atual; chamado logo de início também. */
  onPersona(listener: (persona: SpeakerView) => void): () => void;
  /** Avisa se o mouse está sobre o avatar (fora dele, os cliques atravessam a janela). */
  setInteractive(interactive: boolean): void;
  dragStart(): void;
  /** Deslocamento total, em pixels de tela, desde o início do arraste. */
  dragMove(dx: number, dy: number): void;
  dragEnd(): void;
  openChat(): void;
  /** Clique no balão: próxima página da fala ou, na última, abre o chat. */
  bubbleClick(): void;
  openMenu(): void;
}

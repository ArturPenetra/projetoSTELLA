import { randomUUID } from 'node:crypto';
import {
  ChatSession,
  DEFAULT_SPEAKER,
  LlmError,
  type LlmClient,
  type Memory,
  type Speaker,
  type ToolHost,
} from '@stella/core';
import { MAX_MESSAGE_LENGTH, type ChatEvent, type SpeakerView } from '../shared/ipc.js';

/** Persona que responde, com o elemento (para a cor no chat). */
export type ChatSpeaker = Speaker & Pick<SpeakerView, 'element'>;

const DEFAULT_CHAT_SPEAKER: ChatSpeaker = { ...DEFAULT_SPEAKER, element: 'ar' };

export interface ChatControllerOptions {
  memory?: Memory | undefined;
  speaker?: ChatSpeaker | undefined;
  /** Ferramentas com as permissões do usuário. */
  tools?: ToolHost | undefined;
}

export interface SwitchOptions {
  /**
   * Instrução oculta para a nova persona retomar a conversa (usada se o usuário já disse
   * algo). Como função, recebe as últimas mensagens do usuário para citar o assunto.
   */
  handoff?: string | ((recentUser: string[]) => string);
  /** O que a persona diz quando ainda não há conversa. */
  greeting?: string;
}

/**
 * Liga a sessão de chat aos eventos enviados ao renderer.
 * Não depende do Electron, para ser testado sozinho.
 */
export class ChatController {
  private session: ChatSession;
  private speaker: ChatSpeaker;
  private readonly memory: Memory | undefined;
  private readonly tools: ToolHost | undefined;
  private current: { id: string; abort: AbortController } | undefined;
  /** Falas por conta própria ainda sem resposta do usuário (saem da tela numa nova troca). */
  private pendingHandoffs: string[] = [];

  constructor(
    private readonly llm: LlmClient,
    private readonly emit: (event: ChatEvent) => void,
    options: ChatControllerOptions = {},
  ) {
    this.memory = options.memory;
    this.tools = options.tools;
    this.speaker = options.speaker ?? DEFAULT_CHAT_SPEAKER;
    this.session = this.newSession();
  }

  private newSession(): ChatSession {
    return new ChatSession(this.llm, {
      speaker: this.speaker,
      ...(this.memory ? { memory: this.memory } : {}),
      ...(this.tools ? { tools: this.tools } : {}),
    });
  }

  /** Se há uma resposta (ou ação) em andamento. */
  get busy(): boolean {
    return this.current !== undefined;
  }

  /** Botão de pânico (Esc): cancela o que estiver em andamento, inclusive uma confirmação. */
  cancelAll(): void {
    this.current?.abort.abort();
  }

  get currentSpeaker(): ChatSpeaker {
    return this.speaker;
  }

  /** Se o usuário já disse alguma coisa nesta conversa. */
  get hasConversation(): boolean {
    return this.session.hasUserMessages;
  }

  private speakerView(): SpeakerView {
    return { id: this.speaker.id, name: this.speaker.name, element: this.speaker.element };
  }

  send(text: unknown): { requestId: string } {
    if (typeof text !== 'string' || !text.trim()) {
      throw new Error('Mensagem vazia.');
    }
    if (text.length > MAX_MESSAGE_LENGTH) {
      throw new Error(`Mensagem longa demais (máximo ${MAX_MESSAGE_LENGTH} caracteres).`);
    }
    if (this.current) {
      throw new Error('Espere a resposta atual terminar ou cancele-a.');
    }
    // O usuário respondeu: os cumprimentos anteriores agora fazem parte da conversa.
    this.pendingHandoffs = [];
    return { requestId: this.start(text, false) };
  }

  private start(text: string, hidden: boolean): string {
    const requestId = randomUUID();
    const abort = new AbortController();
    this.current = { id: requestId, abort };
    if (hidden) this.pendingHandoffs.push(requestId);
    this.emit({
      requestId,
      type: 'start',
      kind: hidden ? 'handoff' : 'reply',
      speaker: this.speakerView(),
    });
    void this.run(requestId, text, hidden, abort.signal);
    return requestId;
  }

  /**
   * Troca a persona. Com conversa em andamento, a nova cumprimenta e retoma o assunto
   * (instrução oculta); sem conversa, diz o cumprimento dela. Uma resposta em andamento
   * é cancelada antes.
   */
  async switchTo(speaker: ChatSpeaker, options: SwitchOptions = {}): Promise<void> {
    if (this.current) {
      this.current.abort.abort();
      await this.idle();
    }
    this.speaker = speaker;
    this.session.setSpeaker(speaker);

    // Trocas seguidas: o cumprimento que o usuário ainda não respondeu sai do histórico e
    // da tela. Assim o modelo nunca vê uma fila de personas falando sozinhas.
    this.session.dropPendingHandoffs();
    for (const requestId of this.pendingHandoffs.splice(0)) {
      this.emit({ requestId, type: 'retract' });
    }

    if (this.hasConversation && options.handoff) {
      const { handoff } = options;
      const text =
        typeof handoff === 'function' ? handoff(this.session.recentUserMessages()) : handoff;
      this.start(text, true);
      return;
    }
    if (options.greeting) this.sayNow(options.greeting);
  }

  /** Fala pronta (sem o modelo), mostrada como uma resposta normal. */
  sayNow(text: string): void {
    const requestId = randomUUID();
    this.session.say(text);
    this.pendingHandoffs.push(requestId);
    this.emit({ requestId, type: 'start', kind: 'handoff', speaker: this.speakerView() });
    this.emit({ requestId, type: 'token', text });
    this.emit({ requestId, type: 'done' });
  }

  cancel(requestId: unknown): void {
    if (this.current && this.current.id === requestId) this.current.abort.abort();
  }

  reset(): void {
    this.current?.abort.abort();
    this.pendingHandoffs = [];
    this.session = this.newSession();
    this.memory?.newConversation();
  }

  /** Espera a resposta em andamento terminar (usado nos testes e ao fechar o app). */
  async idle(): Promise<void> {
    while (this.current) await new Promise((r) => setTimeout(r, 5));
  }

  private async run(
    requestId: string,
    text: string,
    hidden: boolean,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      for await (const chunk of this.session.send(text, { signal, hidden })) {
        if (chunk.type === 'token') {
          this.emit({ requestId, type: 'token', text: chunk.text });
        } else if (chunk.type === 'tool') {
          this.emit({
            requestId,
            type: 'tool',
            status: chunk.status,
            name: chunk.name,
            ...(chunk.summary ? { summary: chunk.summary } : {}),
            ...(chunk.decision ? { decision: chunk.decision } : {}),
          });
        } else if (chunk.type === 'done') {
          this.emit({ requestId, type: 'done', ...chunk.stats });
        }
      }
    } catch (err) {
      if (err instanceof LlmError) {
        this.emit({ requestId, type: 'error', code: err.code, message: err.message });
      } else {
        console.error('[chat] erro inesperado', err);
        this.emit({
          requestId,
          type: 'error',
          code: 'internal',
          message: 'Algo deu errado ao gerar a resposta.',
        });
      }
    } finally {
      if (this.current?.id === requestId) this.current = undefined;
    }
  }
}

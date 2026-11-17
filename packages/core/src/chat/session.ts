import type { ChatChunk, ChatMessage, LlmClient } from '../llm/types.js';
import type { ConversationMemory } from '../memory/memory.js';

/** Prompt de quando não há persona (testes e uso sem catálogo). */
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

/** Tamanho máximo de um rótulo "[Nome] " no começo da resposta. */
const MAX_TAG_LENGTH = 32;

/**
 * Tira um rótulo como "[Leo] " do começo da resposta. O histórico mostra as falas das
 * outras personas assim, e o modelo pequeno às vezes copia o formato. Funciona em
 * streaming: segura só os primeiros caracteres até saber se é um rótulo.
 */
export class SpeakerTagFilter {
  private held = '';
  private open = true;

  push(text: string): string {
    if (!this.open) return text;
    this.held += text;
    const start = this.held.trimStart();
    if (!start) return '';
    if (!start.startsWith('[')) return this.release(start);
    const tag = /^\[[^\]\n]{1,30}\]\s*/.exec(start);
    if (tag) {
      const rest = start.slice(tag[0].length);
      // Espera o primeiro caractere depois do rótulo, para não deixar espaços sobrando.
      return rest ? this.release(rest) : '';
    }
    return start.length > MAX_TAG_LENGTH ? this.release(start) : '';
  }

  /** Fim da resposta: devolve o que ficou segurado (sem rótulo, se for só isso). */
  flush(): string {
    if (!this.open) return '';
    const start = this.held.trimStart();
    return this.release(/^\[[^\]\n]{1,30}\]\s*$/.test(start) ? '' : start);
  }

  private release(text: string): string {
    this.open = false;
    this.held = '';
    return text;
  }
}

/** Quem está falando pela companheira agora. */
export interface Speaker {
  id: string;
  name: string;
  /** Prompt de sistema desta persona (sem a memória). */
  systemPrompt: string;
  /** Lembrete extra para uma mensagem específica (só o modelo vê; não fica no histórico). */
  turnNote?: (userText: string) => string | undefined;
}

export const DEFAULT_SPEAKER: Speaker = {
  id: 'stella',
  name: 'Stella',
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
};

/** Mensagem do histórico, com quem falou (só nas respostas da companheira). */
export interface HistoryMessage extends ChatMessage {
  speakerId?: string;
  speakerName?: string;
}

export interface ChatSessionOptions {
  /** Persona que responde. Pode mudar no meio da conversa (`setSpeaker`). */
  speaker?: Speaker;
  /** Quantas mensagens recentes (usuário + assistente) mandar ao modelo. */
  maxHistory?: number;
  /** Memória de longo prazo: lembranças entram no prompt e cada troca é guardada. */
  memory?: ConversationMemory;
}

export interface SendOptions {
  signal?: AbortSignal;
  /**
   * Instrução interna do app (por exemplo, ao trocar de persona): vai para o modelo, mas
   * não entra no histórico nem na memória. Só a resposta fica.
   */
  hidden?: boolean;
}

/** Uma conversa em andamento: guarda o histórico e conversa com o LLM. */
export class ChatSession {
  private readonly history: HistoryMessage[] = [];
  private speaker: Speaker;
  private readonly maxHistory: number;
  private readonly memory: ConversationMemory | undefined;
  private busy = false;

  constructor(
    private readonly llm: LlmClient,
    options: ChatSessionOptions = {},
  ) {
    this.speaker = options.speaker ?? DEFAULT_SPEAKER;
    this.maxHistory = options.maxHistory ?? 20;
    this.memory = options.memory;
  }

  get messages(): readonly HistoryMessage[] {
    return this.history;
  }

  get isBusy(): boolean {
    return this.busy;
  }

  get currentSpeaker(): Speaker {
    return this.speaker;
  }

  /** Troca a persona que responde. O histórico continua (memória única). */
  setSpeaker(speaker: Speaker): void {
    this.speaker = speaker;
  }

  /**
   * Histórico como o modelo vê: falas de outras personas ganham o nome delas entre
   * colchetes, para a persona atual não achar que foi ela que disse.
   */
  private contextHistory(): ChatMessage[] {
    return this.history.slice(-this.maxHistory).map((m) => {
      const other = m.role === 'assistant' && m.speakerId && m.speakerId !== this.speaker.id;
      return {
        role: m.role,
        content: other ? `[${m.speakerName ?? m.speakerId}] ${m.content}` : m.content,
      };
    });
  }

  /**
   * Envia uma mensagem e devolve a resposta em streaming.
   * A troca só entra no histórico se a resposta chegar inteira.
   */
  async *send(text: string, options: SendOptions | AbortSignal = {}): AsyncGenerator<ChatChunk> {
    const { signal, hidden = false } =
      options instanceof AbortSignal ? { signal: options } : options;
    const content = text.trim();
    if (!content) throw new Error('Mensagem vazia.');
    if (this.busy) throw new Error('Já existe uma resposta em andamento.');
    this.busy = true;

    const speaker = this.speaker;
    let reply = '';
    try {
      const userMessage: ChatMessage = { role: 'user', content };
      const lastUser = hidden ? this.history.findLast((m) => m.role === 'user')?.content : content;
      const remembered = await this.memory?.recall(lastUser ?? content, signal, speaker.id);
      const system = remembered ? `${speaker.systemPrompt}\n\n${remembered}` : speaker.systemPrompt;
      // Nota da persona para esta mensagem: vai só para o modelo, nunca para o histórico.
      const note = hidden ? undefined : speaker.turnNote?.(content);
      const context: ChatMessage[] = [
        { role: 'system', content: system },
        ...this.contextHistory(),
        note ? { role: 'user', content: `${content}\n\n${note}` } : userMessage,
      ];
      const previousAssistant = this.history.findLast((m) => m.role === 'assistant')?.content;

      const tag = new SpeakerTagFilter();
      for await (const chunk of this.llm.chat(context, signal ? { signal } : {})) {
        if (chunk.type === 'token') {
          const text = tag.push(chunk.text);
          if (!text) continue;
          reply += text;
          yield { type: 'token', text };
          continue;
        }
        const rest = tag.flush();
        if (rest) {
          reply += rest;
          yield { type: 'token', text: rest };
        }
        yield chunk;
        if (chunk.type === 'done') {
          const answer: HistoryMessage = {
            role: 'assistant',
            content: reply,
            speakerId: speaker.id,
            speakerName: speaker.name,
          };
          if (hidden) {
            this.history.push(answer);
          } else {
            this.history.push(userMessage, answer);
            this.remember(content, reply, speaker.id, previousAssistant);
          }
        }
      }
    } finally {
      this.busy = false;
    }
  }

  private remember(
    user: string,
    assistant: string,
    personaId: string,
    previousAssistant?: string,
  ): void {
    if (!this.memory) return;
    try {
      this.memory.record({
        user,
        assistant,
        personaId,
        ...(previousAssistant ? { previousAssistant } : {}),
      });
    } catch (err) {
      // Falha ao guardar não pode estragar uma resposta que já chegou inteira.
      console.warn('[memória] não consegui guardar a conversa', err);
    }
  }

  /**
   * Fala da companheira que não veio do modelo (por exemplo, o cumprimento do persona.json).
   * Entra no histórico, para a próxima resposta do usuário ter contexto.
   */
  say(text: string): void {
    const content = text.trim();
    if (!content) return;
    this.history.push({
      role: 'assistant',
      content,
      speakerId: this.speaker.id,
      speakerName: this.speaker.name,
    });
  }

  clear(): void {
    this.history.length = 0;
  }
}

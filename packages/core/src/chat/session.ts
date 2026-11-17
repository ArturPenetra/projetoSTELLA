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
 * Tira um rótulo do começo da resposta: "[Leo] " (o formato das falas de outras personas no
 * histórico) ou "Aqua: " (nome de uma persona seguido de dois-pontos). O modelo pequeno às
 * vezes copia esses formatos. Funciona em streaming: segura só os primeiros caracteres até
 * saber se é um rótulo.
 */
export class SpeakerTagFilter {
  private held = '';
  private open = true;
  private readonly prefixes: string[];

  constructor(names: readonly string[] = []) {
    this.prefixes = names.filter(Boolean).map((n) => `${n.toLowerCase()}:`);
  }

  /** Tamanho do rótulo no começo de `start`; 0 = não é rótulo; -1 = ainda não dá para saber. */
  private tagLength(start: string): number {
    if (start.startsWith('[')) {
      const tag = /^\[[^\]\n]{1,30}\]/.exec(start);
      if (tag) return tag[0].length;
      return start.length > MAX_TAG_LENGTH || start.includes('\n') ? 0 : -1;
    }
    const lower = start.toLowerCase();
    for (const p of this.prefixes) {
      if (lower.startsWith(p)) return p.length;
      if (p.startsWith(lower)) return -1;
    }
    return 0;
  }

  push(text: string): string {
    if (!this.open) return text;
    this.held += text;
    const start = this.held.trimStart();
    if (!start) return '';
    const len = this.tagLength(start);
    if (len === -1) return '';
    if (len === 0) return this.release(start);
    // Espera o primeiro caractere depois do rótulo, para não deixar espaços sobrando.
    const rest = start.slice(len).trimStart();
    return rest ? this.release(rest) : '';
  }

  /** Fim da resposta: devolve o que ficou segurado (sem rótulo, se for só isso). */
  flush(): string {
    if (!this.open) return '';
    const start = this.held.trimStart();
    const len = this.tagLength(start);
    return this.release(len > 0 ? start.slice(len).trimStart() : start);
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
  /** Fala por conta própria da persona (cumprimento ou troca), sem pergunta do usuário. */
  handoff?: boolean;
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

  /** Se o usuário já disse alguma coisa nesta conversa. */
  get hasUserMessages(): boolean {
    return this.history.some((m) => m.role === 'user');
  }

  /** As últimas mensagens do usuário, da mais antiga para a mais nova. */
  recentUserMessages(count = 3): string[] {
    return this.history
      .filter((m) => m.role === 'user')
      .slice(-count)
      .map((m) => m.content);
  }

  /**
   * Tira do fim do histórico as falas por conta própria que o usuário ainda não respondeu.
   * Ao trocar de persona várias vezes seguidas, só o cumprimento da última fica: senão o
   * modelo vê uma fila de personas falando sozinhas e perde o assunto e a identidade.
   * Devolve quantas falas saíram.
   */
  dropPendingHandoffs(): number {
    let dropped = 0;
    while (this.history.at(-1)?.handoff) {
      this.history.pop();
      dropped++;
    }
    return dropped;
  }

  /**
   * Histórico como o modelo vê. Tudo até a última fala de outra persona vira uma transcrição
   * no prompt de sistema ("Usuário: ... / Leo: ..."); só o que veio depois (as falas da
   * persona atual) vai como mensagens normais.
   *
   * Medido com o qwen3.5:2b trocando de persona várias vezes: com as falas das outras
   * personas como mensagens de assistente (mesmo rotuladas "[Leo]"), ele passava a continuar
   * a transcrição e repetia falas antigas palavra por palavra. Como transcrição, parou.
   */
  private contextParts(): { transcript: string | undefined; messages: ChatMessage[] } {
    const recent = this.history.slice(-this.maxHistory);
    let cut = 0;
    recent.forEach((m, i) => {
      if (m.role === 'assistant' && m.speakerId && m.speakerId !== this.speaker.id) cut = i + 1;
    });
    const before = recent.slice(0, cut);
    const messages = recent.slice(cut).map((m) => ({ role: m.role, content: m.content }));
    if (before.length === 0) return { transcript: undefined, messages };
    const lines = before.map((m) => {
      const who =
        m.role === 'user'
          ? 'Usuário'
          : m.speakerId === this.speaker.id
            ? `Você (${this.speaker.name})`
            : (m.speakerName ?? m.speakerId ?? 'Outra persona');
      return `${who}: ${m.content.replace(/\s+/g, ' ').trim()}`;
    });
    return {
      transcript: [
        'Conversa até agora, antes de você responder (falas com o nome de outra persona são dela, não suas; não as repita):',
        ...lines,
      ].join('\n'),
      messages,
    };
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
      // Camadas: prompt da persona → memória → transcrição da conversa com outras personas.
      const { transcript, messages } = this.contextParts();
      const system = [speaker.systemPrompt, remembered, transcript].filter(Boolean).join('\n\n');
      // Nota da persona para esta mensagem: vai só para o modelo, nunca para o histórico.
      const note = hidden ? undefined : speaker.turnNote?.(content);
      const context: ChatMessage[] = [
        { role: 'system', content: system },
        ...messages,
        note ? { role: 'user', content: `${content}\n\n${note}` } : userMessage,
      ];
      const previousAssistant = this.history.findLast((m) => m.role === 'assistant')?.content;

      const names = new Set([speaker.name, ...this.history.map((m) => m.speakerName ?? '')]);
      const tag = new SpeakerTagFilter([...names]);
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
            ...(hidden ? { handoff: true } : {}),
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
      handoff: true,
    });
  }

  clear(): void {
    this.history.length = 0;
  }
}

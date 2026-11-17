import type { Embedder } from '../llm/types.js';
import type { ExtractedFact, FactExtractor } from './extractor.js';
import type { Fact, MemoryStore } from './store.js';

export interface MemoryOptions {
  /** Quantos fatos entram no prompt a cada mensagem. */
  topK?: number;
  /** Distância de cosseno abaixo da qual um fato novo é considerado repetido. */
  duplicateDistance?: number;
  /** Persona que está conversando (até a Fase 5, sempre "stella"). */
  personaId?: string;
  /** Avisa quando fatos novos foram guardados. */
  onFactsAdded?: (facts: Fact[]) => void;
  log?: (message: string, err?: unknown) => void;
}

/** O que a sessão de chat precisa da memória. */
export interface ConversationMemory {
  /** Texto com as lembranças relevantes para a mensagem, ou `undefined` se não houver. */
  recall(text: string, signal?: AbortSignal): Promise<string | undefined>;
  /** Guarda a troca no histórico e, em segundo plano, extrai fatos dela. */
  record(exchange: { user: string; assistant: string; previousAssistant?: string }): void;
}

// Medido com o bge-m3: o mesmo fato com outras palavras fica a ~0,02; fatos diferentes
// sobre o mesmo assunto ("mora em Curitiba" × "mora em São Paulo"), a ~0,14.
const DEFAULT_DUPLICATE_DISTANCE = 0.07;

/** Formata as lembranças para o prompt do sistema. */
export function formatMemoryPrompt(facts: Fact[], locale = 'pt-BR'): string | undefined {
  if (facts.length === 0) return undefined;
  const date = new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const lines = [...facts]
    .sort((a, b) => a.updatedAt - b.updatedAt || a.id - b.id)
    .map((f) => {
      const note = f.sensitive ? ' [assunto delicado: só comente se o usuário falar disso]' : '';
      return `- ${f.text} (${date.format(f.updatedAt)})${note}`;
    });
  return [
    'O que você lembra sobre o usuário, de conversas anteriores:',
    ...lines,
    'Use essas lembranças com naturalidade, só quando ajudarem. Não liste tudo de uma vez.',
    'Se duas lembranças se contradizem, vale a mais recente.',
  ].join('\n');
}

/**
 * Memória de longo prazo: histórico no SQLite, fatos extraídos de cada mensagem e busca
 * vetorial dos mais relevantes. Falhas de embedding ou extração nunca quebram o chat:
 * a conversa segue, só sem lembrar (ou sem aprender) naquela mensagem.
 */
export class Memory implements ConversationMemory {
  private conversationId: number | undefined;
  private queue: Promise<void> = Promise.resolve();
  private readonly topK: number;
  private readonly duplicateDistance: number;
  private readonly personaId: string;
  private readonly log: (message: string, err?: unknown) => void;
  private indexReady = false;

  constructor(
    readonly store: MemoryStore,
    private readonly embedder: Embedder,
    private readonly extractor: FactExtractor,
    private readonly options: MemoryOptions = {},
  ) {
    this.topK = options.topK ?? 5;
    this.duplicateDistance = options.duplicateDistance ?? DEFAULT_DUPLICATE_DISTANCE;
    this.personaId = options.personaId ?? 'stella';
    this.log = options.log ?? ((m, e) => console.warn(`[memória] ${m}`, e ?? ''));
  }

  /**
   * Carrega o modelo de embedding (a frio ele demora) e indexa fatos que estejam sem vetor,
   * por exemplo depois de trocar de modelo. Pode rodar em segundo plano.
   */
  async warmUp(signal?: AbortSignal): Promise<void> {
    try {
      await this.ensureIndex(signal);
      const missing = this.store.factsWithoutEmbedding();
      if (missing.length === 0) return;
      const vectors = await this.embedder.embed(
        missing.map((f) => f.text),
        signal,
      );
      missing.forEach((f, i) => this.store.setEmbedding(f.id, vectors[i] as Float32Array));
    } catch (err) {
      this.log('não consegui preparar o índice de fatos', err);
    }
  }

  private async ensureIndex(signal?: AbortSignal): Promise<void> {
    if (this.indexReady) return;
    const [probe] = await this.embedder.embed(['dimensão'], signal);
    this.store.ensureIndex(this.embedder.model, (probe as Float32Array).length);
    this.indexReady = true;
  }

  /** Lembranças relevantes para a mensagem, prontas para o prompt. */
  async recall(text: string, signal?: AbortSignal): Promise<string | undefined> {
    return formatMemoryPrompt(await this.relevantFacts(text, signal));
  }

  /** Até `topK` fatos. Com poucos fatos, vão todos (não precisa calcular embedding). */
  async relevantFacts(text: string, signal?: AbortSignal): Promise<Fact[]> {
    const all = this.store.listFacts();
    if (all.length <= this.topK) return all;
    try {
      await this.ensureIndex(signal);
      const [query] = await this.embedder.embed([text], signal);
      const found = this.store.nearestFacts(query as Float32Array, this.topK).map((m) => m.fact);
      if (found.length > 0) return found;
    } catch (err) {
      if (signal?.aborted) throw err;
      this.log('busca vetorial falhou; usando os fatos mais recentes', err);
    }
    return [...all].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, this.topK);
  }

  record(exchange: { user: string; assistant: string; previousAssistant?: string }): void {
    this.conversationId ??= this.store.startConversation();
    const messageId = this.store.addMessage(
      this.conversationId,
      'user',
      exchange.user,
      this.personaId,
    );
    this.store.addMessage(this.conversationId, 'assistant', exchange.assistant, this.personaId);
    // Uma extração por vez, na ordem das mensagens.
    this.queue = this.queue.then(() => this.learn(exchange, messageId));
  }

  /** Espera as extrações pendentes (testes e fechamento do app). */
  whenIdle(): Promise<void> {
    return this.queue;
  }

  /** A próxima mensagem começa outra conversa no histórico. */
  newConversation(): void {
    this.conversationId = undefined;
  }

  private async learn(
    exchange: { user: string; previousAssistant?: string },
    sourceMessageId: number,
  ): Promise<void> {
    let extracted: ExtractedFact[];
    try {
      extracted = await this.extractor.extract(exchange);
    } catch (err) {
      this.log('não consegui extrair fatos da mensagem', err);
      return;
    }
    if (extracted.length === 0) return;

    let vectors: (Float32Array | undefined)[] = [];
    try {
      await this.ensureIndex();
      vectors = await this.embedder.embed(extracted.map((f) => f.text));
    } catch (err) {
      // Guarda mesmo assim; o vetor é calculado depois, no próximo warmUp.
      this.log('não consegui calcular o embedding dos fatos novos', err);
    }

    const added: Fact[] = [];
    extracted.forEach((f, i) => {
      const vector = vectors[i];
      const duplicate =
        this.store.findSameText(f.text) ??
        (vector
          ? this.store.nearestFacts(vector, 1).find((m) => m.distance <= this.duplicateDistance)
              ?.fact
          : undefined);
      if (duplicate) {
        this.store.touchFact(duplicate.id);
        return;
      }
      added.push(
        this.store.addFact(
          { text: f.text, sensitive: f.sensitive, personaId: this.personaId, sourceMessageId },
          vector,
        ),
      );
    });
    if (added.length > 0) this.options.onFactsAdded?.(added);
  }

  // --- Tela de memória ------------------------------------------------------------------

  listFacts(): Fact[] {
    return this.store.listFacts();
  }

  /** Edita o texto de um fato e recalcula o vetor. */
  async updateFact(id: number, text: string): Promise<Fact | undefined> {
    const clean = text.replace(/\s+/g, ' ').trim();
    if (!clean) throw new Error('O fato não pode ficar vazio.');
    let vector: Float32Array | undefined;
    try {
      await this.ensureIndex();
      [vector] = await this.embedder.embed([clean]);
    } catch (err) {
      this.log('não consegui calcular o embedding do fato editado', err);
    }
    return this.store.updateFact(id, clean, vector);
  }

  deleteFact(id: number): boolean {
    return this.store.deleteFact(id);
  }

  /** Esquece todos os fatos; com `history`, apaga também as conversas guardadas. */
  clear(options: { history?: boolean } = {}): void {
    this.store.clearFacts();
    if (options.history) {
      this.store.clearHistory();
      this.conversationId = undefined;
    }
  }
}

/** Estados de animação do avatar. São os mesmos para todas as personas. */
export type AvatarMood = 'parado' | 'pensando' | 'falando' | 'feliz';

export interface AvatarSnapshot {
  mood: AvatarMood;
  /** Texto do balão de fala (a página atual); `null` esconde o balão. */
  bubble: string | null;
  /** O balão mostra "digitando…" (resposta ainda não começou). */
  typing: boolean;
  /** Página mostrada (começa em 1) e total de páginas até agora (cresce no streaming). */
  page: number;
  pages: number;
}

export interface AvatarTimings {
  /** Quanto tempo o avatar fica feliz depois de mostrar a última página. */
  happyMs: number;
  /** Tempo de leitura de cada página: por caractere, mínimo e máximo. */
  pageMsPerChar: number;
  pageMinMs: number;
  pageMaxMs: number;
  /** A última página fica pelo menos este tempo antes de o balão sumir. */
  lastPageMinMs: number;
}

export const DEFAULT_AVATAR_TIMINGS: AvatarTimings = {
  happyMs: 2500,
  pageMsPerChar: 60,
  pageMinMs: 3000,
  pageMaxMs: 10000,
  lastPageMinMs: 6000,
};

/**
 * Máximo de caracteres por página do balão. Medido na janela da companheira (300 px de
 * largura): 150 caracteres ocupam até 6 linhas e cabem acima do avatar sem cortar.
 */
export const PAGE_MAX_CHARS = 150;

/** Quebra em pedaços de até `max`, entre palavras (palavra maior que `max` é partida). */
function splitWords(text: string, max: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (let word of text.split(' ')) {
    while (word.length > max) {
      if (cur) out.push(cur);
      cur = '';
      out.push(word.slice(0, max));
      word = word.slice(max);
    }
    if (!word) continue;
    if (!cur) cur = word;
    else if (cur.length + 1 + word.length <= max) cur += ` ${word}`;
    else {
      out.push(cur);
      cur = word;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * Divide a fala em páginas que cabem no balão, sem perder nada: junta frases inteiras
 * enquanto couberem e só quebra no meio de uma frase se ela sozinha não couber.
 * Juntar as páginas com espaço devolve o texto inteiro (com os espaços normalizados).
 */
export function paginate(text: string, max = PAGE_MAX_CHARS): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const sentences = clean.match(/[^.!?…]+(?:[.!?…]+["”')\]]*|$)/g) ?? [clean];
  const pages: string[] = [];
  let cur = '';
  for (const sentence of sentences) {
    const s = sentence.trim();
    if (!s) continue;
    for (const piece of s.length <= max ? [s] : splitWords(s, max)) {
      if (!cur) cur = piece;
      else if (cur.length + 1 + piece.length <= max) cur += ` ${piece}`;
      else {
        pages.push(cur);
        cur = piece;
      }
    }
  }
  if (cur) pages.push(cur);
  return pages;
}

type SpeechKind = 'reply' | 'say' | 'error';

/**
 * Decide o estado do avatar a partir do que acontece no chat.
 * Não depende do Electron: recebe eventos e avisa cada mudança por `onChange`.
 *
 * parado → (mensagem enviada) pensando → (primeiro pedaço) falando → (última página) feliz → parado
 *
 * A fala inteira aparece no balão: se não couber, vira várias páginas, mostradas em
 * sequência, cada uma pelo tempo de leitura dela (ou até o usuário clicar).
 */
export class AvatarDirector {
  private state: AvatarSnapshot = {
    mood: 'parado',
    bubble: null,
    typing: false,
    page: 0,
    pages: 0,
  };
  private speech: { text: string; streaming: boolean; kind: SpeechKind } | undefined;
  private pageIndex = 0;
  private pageShownAt = 0;
  private finaleStarted = false;
  private pageTimer: ReturnType<typeof setTimeout> | undefined;
  private moodTimer: ReturnType<typeof setTimeout> | undefined;
  private hideTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly onChange: (snapshot: AvatarSnapshot) => void,
    private readonly timings: AvatarTimings = DEFAULT_AVATAR_TIMINGS,
  ) {}

  get snapshot(): AvatarSnapshot {
    return { ...this.state };
  }

  /** O usuário mandou uma mensagem: a companheira começa a pensar. */
  userSent(): void {
    this.reset();
    this.speech = { text: '', streaming: true, kind: 'reply' };
    this.set({ mood: 'pensando', bubble: '', typing: true, page: 0, pages: 0 });
  }

  /** Chegou mais um pedaço da resposta. */
  token(text: string): void {
    if (!this.speech || this.speech.kind !== 'reply' || !this.speech.streaming) {
      this.reset();
      this.speech = { text: '', streaming: true, kind: 'reply' };
    }
    this.speech.text += text;
    this.render();
  }

  /** A resposta terminou: as páginas que faltam continuam aparecendo. */
  done(): void {
    if (!this.speech || !this.speech.text.trim()) {
      this.reset();
      this.set({ mood: 'parado', bubble: null, typing: false, page: 0, pages: 0 });
      return;
    }
    this.speech.streaming = false;
    this.render();
  }

  /** A resposta falhou. Mostra a mensagem e volta a ficar parada. */
  failed(message: string): void {
    this.start(message, 'error');
  }

  /** O usuário parou a resposta ou começou uma conversa nova. */
  cancelled(): void {
    this.reset();
    this.set({ mood: 'parado', bubble: null, typing: false, page: 0, pages: 0 });
  }

  /** Fala algo por iniciativa própria (por exemplo, o cumprimento ao abrir o app). */
  say(text: string): void {
    if (this.state.mood === 'pensando' || (this.speech?.streaming ?? false)) return;
    this.start(text, 'say');
  }

  /**
   * Clique no balão: vai para a próxima página, se ela já estiver completa.
   * Devolve `false` se não havia próxima página (aí o clique abre o chat).
   */
  next(): boolean {
    if (!this.speech) return false;
    const pages = paginate(this.speech.text);
    if (this.pageIndex >= pages.length - 1) return false;
    this.showPage(this.pageIndex + 1);
    return true;
  }

  dispose(): void {
    this.clearTimers();
  }

  private start(text: string, kind: SpeechKind): void {
    this.reset();
    if (!text.trim()) {
      this.set({ mood: 'parado', bubble: null, typing: false, page: 0, pages: 0 });
      return;
    }
    this.speech = { text, streaming: false, kind };
    this.render();
  }

  private reset(): void {
    this.clearTimers();
    this.speech = undefined;
    this.pageIndex = 0;
    this.pageShownAt = Date.now();
    this.finaleStarted = false;
  }

  private readMs(page: string, last: boolean): number {
    const { pageMsPerChar, pageMinMs, pageMaxMs, lastPageMinMs } = this.timings;
    const ms = Math.min(pageMaxMs, Math.max(pageMinMs, page.length * pageMsPerChar));
    return last ? Math.max(ms, lastPageMinMs) : ms;
  }

  private showPage(index: number): void {
    this.pageIndex = index;
    this.pageShownAt = Date.now();
    clearTimeout(this.pageTimer);
    this.pageTimer = undefined;
    this.render();
  }

  /** Mostra a página atual e agenda o que vem depois (próxima página ou o fim). */
  private render(): void {
    const speech = this.speech;
    if (!speech) return;
    const pages = paginate(speech.text);
    if (pages.length === 0) return;
    this.pageIndex = Math.min(this.pageIndex, pages.length - 1);
    const page = pages[this.pageIndex] as string;
    const isLast = this.pageIndex === pages.length - 1;
    const finished = isLast && !speech.streaming;

    let mood: AvatarMood = 'falando';
    if (speech.kind === 'error') mood = 'parado';
    else if (finished) mood = this.finaleStarted ? this.state.mood : 'feliz';

    this.set({
      mood,
      bubble: page,
      typing: false,
      page: this.pageIndex + 1,
      pages: pages.length,
    });

    if (!isLast) {
      // Página completa (já existe a próxima): passa depois do tempo de leitura dela.
      if (!this.pageTimer) {
        const wait = Math.max(0, this.pageShownAt + this.readMs(page, false) - Date.now());
        this.pageTimer = setTimeout(() => {
          this.pageTimer = undefined;
          this.showPage(this.pageIndex + 1);
        }, wait);
      }
      return;
    }
    if (!finished || this.finaleStarted) return;

    // Última página: fica feliz, volta a ficar parada e o balão some depois da leitura.
    this.finaleStarted = true;
    if (speech.kind !== 'error') {
      this.moodTimer = setTimeout(() => this.set({ mood: 'parado' }), this.timings.happyMs);
    }
    const wait = Math.max(0, this.pageShownAt + this.readMs(page, true) - Date.now());
    this.hideTimer = setTimeout(() => {
      this.speech = undefined;
      this.set({ bubble: null, page: 0, pages: 0 });
    }, wait);
  }

  private clearTimers(): void {
    clearTimeout(this.pageTimer);
    clearTimeout(this.moodTimer);
    clearTimeout(this.hideTimer);
    this.pageTimer = this.moodTimer = this.hideTimer = undefined;
  }

  private set(patch: Partial<AvatarSnapshot>): void {
    const next = { ...this.state, ...patch };
    if (
      next.mood === this.state.mood &&
      next.bubble === this.state.bubble &&
      next.typing === this.state.typing &&
      next.page === this.state.page &&
      next.pages === this.state.pages
    ) {
      return;
    }
    this.state = next;
    this.onChange({ ...next });
  }
}

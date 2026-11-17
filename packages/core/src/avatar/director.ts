/** Estados de animação do avatar. São os mesmos para todas as personas. */
export type AvatarMood = 'parado' | 'pensando' | 'falando' | 'feliz';

export interface AvatarSnapshot {
  mood: AvatarMood;
  /** Texto do balão de fala; `null` esconde o balão. */
  bubble: string | null;
  /** O balão mostra "digitando…" (resposta ainda não começou). */
  typing: boolean;
}

export interface AvatarTimings {
  /** Quanto tempo o avatar fica feliz depois de terminar uma resposta. */
  happyMs: number;
  /** Tempo de leitura do balão: mínimo, máximo e por caractere. */
  bubbleMinMs: number;
  bubbleMaxMs: number;
  bubbleMsPerChar: number;
}

export const DEFAULT_AVATAR_TIMINGS: AvatarTimings = {
  happyMs: 2500,
  bubbleMinMs: 6000,
  bubbleMaxMs: 20000,
  bubbleMsPerChar: 60,
};

/** Tamanho máximo do texto no balão; a resposta completa fica na janela de chat. */
export const BUBBLE_MAX_CHARS = 220;

/**
 * Ajusta um texto ao balão. Durante o streaming mostra o final (o que está sendo dito);
 * depois mostra o começo, com reticências se não couber.
 */
export function fitBubble(text: string, streaming: boolean, max = BUBBLE_MAX_CHARS): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  if (streaming) return '…' + clean.slice(clean.length - (max - 1)).trimStart();
  const cut = clean.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + '…';
}

/**
 * Decide o estado do avatar a partir do que acontece no chat.
 * Não depende do Electron: recebe eventos e avisa cada mudança por `onChange`.
 *
 * parado → (mensagem enviada) pensando → (primeiro pedaço) falando → (fim) feliz → parado
 */
export class AvatarDirector {
  private state: AvatarSnapshot = { mood: 'parado', bubble: null, typing: false };
  private reply = '';
  private moodTimer: ReturnType<typeof setTimeout> | undefined;
  private bubbleTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly onChange: (snapshot: AvatarSnapshot) => void,
    private readonly timings: AvatarTimings = DEFAULT_AVATAR_TIMINGS,
  ) {}

  get snapshot(): AvatarSnapshot {
    return { ...this.state };
  }

  /** O usuário mandou uma mensagem: a companheira começa a pensar. */
  userSent(): void {
    this.clearTimers();
    this.reply = '';
    this.set({ mood: 'pensando', bubble: '', typing: true });
  }

  /** Chegou mais um pedaço da resposta. */
  token(text: string): void {
    this.clearTimers();
    this.reply += text;
    this.set({ mood: 'falando', bubble: fitBubble(this.reply, true), typing: false });
  }

  /** A resposta terminou. */
  done(): void {
    this.clearTimers();
    if (!this.reply.trim()) {
      this.set({ mood: 'parado', bubble: null, typing: false });
      return;
    }
    const text = fitBubble(this.reply, false);
    this.set({ mood: 'feliz', bubble: text, typing: false });
    this.moodTimer = setTimeout(() => this.set({ mood: 'parado' }), this.timings.happyMs);
    this.scheduleBubbleHide(text);
  }

  /** A resposta falhou. Mostra uma mensagem curta e volta a ficar parada. */
  failed(message: string): void {
    this.clearTimers();
    const text = fitBubble(message, false);
    this.set({ mood: 'parado', bubble: text, typing: false });
    this.scheduleBubbleHide(text);
  }

  /** O usuário parou a resposta ou começou uma conversa nova. */
  cancelled(): void {
    this.clearTimers();
    this.reply = '';
    this.set({ mood: 'parado', bubble: null, typing: false });
  }

  /** Fala algo por iniciativa própria (por exemplo, o cumprimento ao abrir o app). */
  say(text: string): void {
    if (this.state.mood === 'pensando' || this.state.mood === 'falando') return;
    this.clearTimers();
    const fitted = fitBubble(text, false);
    this.set({ mood: 'feliz', bubble: fitted, typing: false });
    this.moodTimer = setTimeout(() => this.set({ mood: 'parado' }), this.timings.happyMs);
    this.scheduleBubbleHide(fitted);
  }

  dispose(): void {
    this.clearTimers();
  }

  private scheduleBubbleHide(text: string): void {
    const { bubbleMinMs, bubbleMaxMs, bubbleMsPerChar } = this.timings;
    const ms = Math.min(bubbleMaxMs, Math.max(bubbleMinMs, text.length * bubbleMsPerChar));
    this.bubbleTimer = setTimeout(() => this.set({ bubble: null }), ms);
  }

  private clearTimers(): void {
    clearTimeout(this.moodTimer);
    clearTimeout(this.bubbleTimer);
    this.moodTimer = this.bubbleTimer = undefined;
  }

  private set(patch: Partial<AvatarSnapshot>): void {
    const next = { ...this.state, ...patch };
    if (
      next.mood === this.state.mood &&
      next.bubble === this.state.bubble &&
      next.typing === this.state.typing
    ) {
      return;
    }
    this.state = next;
    this.onChange({ ...next });
  }
}

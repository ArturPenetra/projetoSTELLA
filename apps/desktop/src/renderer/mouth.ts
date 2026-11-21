/**
 * Boca pelo volume do áudio: abre acima de `openAt`, fecha abaixo de `closeAt` (a faixa
 * entre os dois evita piscar quando o volume fica em cima do limite). Sem volume novo por
 * `timeoutMs`, o áudio deixa de mandar na boca e o avatar volta ao comportamento normal.
 */
export interface MouthOptions {
  openAt: number;
  closeAt: number;
  timeoutMs: number;
}

export const MOUTH_DEFAULTS: MouthOptions = { openAt: 0.15, closeAt: 0.08, timeoutMs: 300 };

export class MouthTracker {
  private open = false;
  private lastAt: number | undefined;
  private readonly options: MouthOptions;

  constructor(options: Partial<MouthOptions> = {}) {
    this.options = { ...MOUTH_DEFAULTS, ...options };
    if (this.options.closeAt > this.options.openAt) {
      throw new Error('closeAt precisa ser menor ou igual a openAt.');
    }
  }

  /** Registra um volume (0 a 1) recebido em `now` (ms) e diz se a boca fica aberta. */
  update(level: number, now: number): boolean {
    const value = Number.isFinite(level) ? level : 0;
    this.lastAt = now;
    if (this.open) {
      if (value < this.options.closeAt) this.open = false;
    } else if (value > this.options.openAt) {
      this.open = true;
    }
    return this.open;
  }

  /** O áudio ainda manda na boca? (recebeu volume há menos de `timeoutMs`) */
  isActive(now: number): boolean {
    if (this.lastAt === undefined) return false;
    if (now - this.lastAt < this.options.timeoutMs) return true;
    this.lastAt = undefined;
    this.open = false;
    return false;
  }

  get timeoutMs(): number {
    return this.options.timeoutMs;
  }
}

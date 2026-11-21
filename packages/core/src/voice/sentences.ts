/**
 * Divide a resposta em pedaços para falar enquanto o modelo ainda escreve (a voz começa
 * na primeira frase, sem esperar o fim). O primeiro pedaço pode terminar numa vírgula,
 * para a primeira palavra sair mais cedo; os outros vão até o fim da frase.
 */
export interface SentenceSplitterOptions {
  /** O primeiro pedaço pode parar numa vírgula depois deste tamanho. */
  firstMinChars?: number;
  /** Primeiro pedaço sem pontuação até aqui: corta numa palavra. */
  firstMaxChars?: number;
  /** Sem fim de frase até aqui, corta na última vírgula ou espaço. */
  maxChars?: number;
}

/** Abreviações comuns: o ponto delas não termina a frase. */
const ABBREVIATIONS = new Set([
  'sr',
  'sra',
  'srta',
  'dr',
  'dra',
  'prof',
  'profa',
  'etc',
  'ex',
  'obs',
  'pág',
  'p',
  'av',
  'n',
  'nº',
  'vs',
  'aprox',
]);

/** Espaço antes de palavras onde uma pausa soa natural. */
const JOINERS = / (?=(?:que|e|quando|mas|porque|para|se|com|como|onde|ou)\s)/giu;

export class SentenceSplitter {
  private buffer = '';
  private emitted = 0;
  private readonly firstMinChars: number;
  private readonly maxChars: number;
  private readonly firstMaxChars: number;

  constructor(options: SentenceSplitterOptions = {}) {
    this.firstMinChars = options.firstMinChars ?? 12;
    this.firstMaxChars = options.firstMaxChars ?? 36;
    this.maxChars = options.maxChars ?? 220;
  }

  /** Recebe um pedaço do texto e devolve os pedaços prontos para falar. */
  push(text: string): string[] {
    this.buffer += text;
    const out: string[] = [];
    for (let piece = this.next(); piece !== undefined; piece = this.next()) {
      if (piece) out.push(piece);
    }
    return out;
  }

  /** Fim da resposta: o que sobrou. */
  flush(): string[] {
    const rest = this.buffer.trim();
    this.buffer = '';
    if (!rest) return [];
    this.emitted++;
    return [rest];
  }

  private take(end: number): string {
    const piece = this.buffer.slice(0, end).trim();
    this.buffer = this.buffer.slice(end);
    if (piece) this.emitted++;
    return piece;
  }

  private next(): string | undefined {
    const text = this.buffer;
    // Quebra de linha sempre separa (listas, parágrafos).
    const newline = text.indexOf('\n');
    const end = this.sentenceEnd(text);
    if (newline >= 0 && (end === undefined || newline < end)) return this.take(newline + 1);
    if (end !== undefined) return this.take(end);
    if (this.emitted === 0) {
      const comma = this.firstComma(text);
      if (comma !== undefined) return this.take(comma);
      const cut = this.firstCut(text);
      if (cut !== undefined) return this.take(cut);
    }
    if (text.length > this.maxChars) {
      const window = text.slice(0, this.maxChars);
      const cut = Math.max(window.lastIndexOf(', '), window.lastIndexOf('; '));
      const at = cut > 0 ? cut + 1 : window.lastIndexOf(' ');
      return this.take(at > 0 ? at : this.maxChars);
    }
    return undefined;
  }

  /** Posição logo depois do fim da primeira frase completa (pontuação + espaço). */
  private sentenceEnd(text: string): number | undefined {
    const re = /([.!?…]+)["')\]]*\s/g;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      const before = text.slice(0, m.index);
      if (m[1] === '.') {
        const word = /([\p{L}º]+)$/u.exec(before)?.[1]?.toLowerCase();
        if (word && ABBREVIATIONS.has(word)) continue;
      }
      if (before.trim().length === 0) continue;
      return m.index + m[0].length;
    }
    return undefined;
  }

  /**
   * Primeira frase longa sem pontuação: corta numa palavra para a voz começar logo
   * (sintetizar leva ~0,6 s a cada 30 letras). De preferência antes de "que", "e",
   * "quando"..., onde a pausa soa natural; senão, no último espaço antes do limite.
   */
  private firstCut(text: string): number | undefined {
    if (text.length <= this.firstMaxChars) return undefined;
    const window = text.slice(0, this.firstMaxChars + 1);
    let best: number | undefined;
    for (const m of window.matchAll(JOINERS)) {
      if (m.index >= 8) best = m.index;
    }
    if (best !== undefined) return best + 1;
    const space = window.lastIndexOf(' ');
    return space >= this.firstMinChars ? space + 1 : undefined;
  }

  private firstComma(text: string): number | undefined {
    const re = /[,;:]\s/g;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      if (m.index >= this.firstMinChars) return m.index + m[0].length;
    }
    return undefined;
  }
}

/**
 * Deixa o texto pronto para a voz: sem emojis, marcações (*, #, `), links e símbolos
 * soltos. Devolve '' se não sobrar nada para falar.
 */
export function speakable(text: string): string {
  const clean = text
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Modifier}️‍]+/gu, ' ')
    .replace(/[*_#`~|<>[\]{}]/g, ' ')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  return /[\p{L}\p{N}]/u.test(clean) ? clean : '';
}

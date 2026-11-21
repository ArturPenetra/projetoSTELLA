/**
 * Correção dos nomes no texto reconhecido. O Parakeet não conhece os nomes das personas
 * e escreve o que soa parecido ("Léo", "Corney", "Pixie", "Estela"). Cada persona lista
 * em `persona.json` (`heardAs`) como o reconhecimento costuma ouvir o nome dela; a lista
 * foi medida com vozes sintéticas (docs/voz-modelos.md, "Nomes das personas").
 *
 * Variantes que não são palavras do português são trocadas sempre. As que são
 * ("água", "tela", "pix") só viram nome quando a frase usa a palavra para chamar alguém
 * ("Oi, Água", "Água, me conta") ou para trocar de persona ("troca pra Água"). Maiúscula
 * não conta: o reconhecimento escreve "pagar com o Pix". "Quero beber água" fica.
 */

export interface NameEntry {
  /** Como o nome deve ficar escrito. */
  name: string;
  /** Como o reconhecimento ouve o nome (uma ou mais palavras). */
  heardAs?: readonly string[] | undefined;
}

/**
 * O nome do app. O Parakeet ouve "Estela" quase sempre e, no começo da frase, "Tela"
 * (o "s" some).
 */
export const STELLA_NAME: NameEntry = {
  name: 'Stella',
  heardAs: ['Estela', 'Estella', 'Stela', 'Tela', 'Tele'],
};

/**
 * Palavras do português (sem acento, minúsculas) que o reconhecimento também escreve
 * no lugar de um nome. Só são trocadas quando a frase as usa como nome (`asName`).
 * Inclui algumas que ainda não apareceram, para quem acrescentar `heardAs` depois.
 */
export const COMMON_WORDS: ReadonlySet<string> = new Set([
  'agua',
  'tela',
  'tele',
  'pix',
  'pique',
  'cone',
  'corner',
  'leu',
  'vive',
  'canse',
  'cancer',
  'corte',
  'corpo',
  'gene',
  'leao',
  'corno',
  'saga',
  'touro',
]);

/** Palavras que vêm antes de um nome chamado: "oi Aqua", "obrigada, Pixi", "bom dia, Leo". */
const BEFORE_VOCATIVE = new Set([
  'oi',
  'ola',
  'ei',
  'eii',
  'hey',
  'alo',
  'opa',
  'salve',
  'ai', // "e aí, Leo"
  'obrigado',
  'obrigada',
  'brigado',
  'brigada',
  'valeu',
  'tchau',
  'ciao',
  'xau',
  'dia', // "bom dia, Aqua"
  'tarde',
  'noite',
  'querida',
  'querido',
]);

/** Verbos de troca de persona: "troca pra Aqua", "chama a Pixi", "falar com a Aqua". */
const SWITCH_VERBS = new Set([
  'troca',
  'trocar',
  'troque',
  'muda',
  'mudar',
  'mude',
  'chama',
  'chamar',
  'chame',
  'passa',
  'passar',
  'passe',
  'volta',
  'voltar',
  'volte',
  'fala',
  'falar',
  'conversar',
]);

/** Palavras entre o verbo de troca e o nome ("troca para a", "falar com o"). */
const SWITCH_LINKS = new Set(['para', 'pra', 'pro', 'a', 'o', 'com']);

/** Uma delas precisa estar entre o verbo e o nome ("passa o pix" não é troca). */
const SWITCH_PREPOSITIONS = new Set(['para', 'pra', 'pro', 'com']);

/** Verbos que chamam alguém direto, sem preposição ("chama a Água"). */
const CALL_VERBS = new Set(['chama', 'chamar', 'chame']);

/**
 * Palavras que, logo depois de um nome no começo da frase, mostram que ele está sendo
 * chamado mesmo sem vírgula ("Aqua me conta", "Tela abre a calculadora").
 */
const AFTER_VOCATIVE = new Set([
  'me',
  'voce',
  'vc',
  'tu',
  'abre',
  'abra',
  'fecha',
  'feche',
  'organiza',
  'conta',
  'diz',
  'fala',
  'que',
  'qual',
  'quais',
  'como',
  'onde',
  'quando',
  'pode',
  'sabe',
  'lembra',
  'bora',
  'vamos',
  'tudo',
]);

/** Minúsculas e sem acentos ("Água" → "agua"). */
export function foldName(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

interface Word {
  text: string;
  folded: string;
  start: number;
  end: number;
}

interface Variant {
  words: string[];
  name: string;
  common: boolean;
}

const WORD = /[\p{L}\p{M}\p{N}]+/gu;

function splitWords(text: string): Word[] {
  return Array.from(text.matchAll(WORD), (m) => ({
    text: m[0],
    folded: foldName(m[0]),
    start: m.index,
    end: m.index + m[0].length,
  }));
}

/** O que há entre duas palavras (espaços e pontuação). */
function gap(text: string, words: Word[], i: number): string {
  const prev = words[i - 1];
  const cur = words[i];
  return text.slice(prev ? prev.end : 0, cur ? cur.start : text.length);
}

/** A palavra `i` começa uma frase (início do texto ou depois de . ! ? …). */
function startsSentence(text: string, words: Word[], i: number): boolean {
  return i === 0 || /[.!?…]/.test(gap(text, words, i));
}

/**
 * A palavra comum em `words[i..end)` está sendo usada como nome? Só aceita os casos
 * medidos; na dúvida, fica a palavra (corrigir "água" para "Aqua" é pior que o contrário).
 */
function asName(text: string, words: Word[], i: number, end: number): boolean {
  const first = words[i] as Word;
  const before = words[i - 1];
  const after = words[end];
  const gapBefore = gap(text, words, i);
  const gapAfter = gap(text, words, end);
  const sentenceStart = startsSentence(text, words, i);

  // "oi, Água" / "obrigada Água" (só espaço ou vírgula entre eles).
  if (
    before &&
    !sentenceStart &&
    /^[\s,]*$/.test(gapBefore) &&
    BEFORE_VOCATIVE.has(before.folded)
  ) {
    return true;
  }

  // "troca pra Água", "falar com a Água", "chama a Água": verbo de troca e ligações.
  // Precisa de preposição ("passa o pix" fica), menos com "chamar".
  if (!sentenceStart) {
    let j = i - 1;
    while (j >= 0 && j >= i - 3 && SWITCH_LINKS.has((words[j] as Word).folded)) j--;
    const verb = words[j];
    const links = words.slice(j + 1, i).map((w) => w.folded);
    if (
      links.length > 0 &&
      verb &&
      SWITCH_VERBS.has(verb.folded) &&
      (CALL_VERBS.has(verb.folded) || links.some((l) => SWITCH_PREPOSITIONS.has(l))) &&
      !/[.!?…]/.test(text.slice(verb.end, first.start))
    ) {
      return true;
    }
    // Maiúscula no meio da frase não conta: o reconhecimento escreve "com o Pix".
    return false;
  }

  if (!after) return false;
  // "Água, me conta..." (vocativo), mas não "Água, por favor".
  if (/^\s*,/.test(gapAfter)) {
    const rest = words.slice(end).map((w) => w.folded);
    const politeOnly = rest.length <= 2 && rest[0] === 'por' && rest[1] === 'favor';
    return !politeOnly && !/[.!?…]/.test(gapAfter);
  }
  // "Tela abre a calculadora", "Aqua me conta" (sem vírgula).
  return /^\s+$/.test(gapAfter) && AFTER_VOCATIVE.has(after.folded);
}

/**
 * Cria a função que troca, no texto reconhecido, cada variante ouvida pelo nome certo.
 * Compara sem maiúsculas e sem acentos, só palavras inteiras; variantes de mais de uma
 * palavra ("Cor ni") também valem. Variantes que são palavras do português
 * (`commonWords`) só são trocadas quando a frase as usa como nome.
 */
export function createNameFixer(
  entries: readonly NameEntry[],
  commonWords: ReadonlySet<string> = COMMON_WORDS,
): (text: string) => string {
  const variants: Variant[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    for (const heard of [entry.name, ...(entry.heardAs ?? [])]) {
      const words = splitWords(heard).map((w) => w.folded);
      const key = words.join(' ');
      if (words.length === 0 || seen.has(key)) continue;
      seen.add(key);
      variants.push({
        words,
        name: entry.name,
        common: words.length === 1 && commonWords.has(key),
      });
    }
  }
  // As mais longas primeiro: "Cor ni" antes de "Cor".
  variants.sort((a, b) => b.words.length - a.words.length);

  return (text) => {
    const words = splitWords(text);
    let out = '';
    let last = 0;
    for (let i = 0; i < words.length;) {
      const match = variants.find((v) =>
        v.words.every((w, k) => {
          const word = words[i + k];
          // Só espaço entre as palavras de uma variante.
          return word?.folded === w && (k === 0 || /^\s+$/.test(gap(text, words, i + k)));
        }),
      );
      const end = i + (match?.words.length ?? 1);
      if (match && (!match.common || asName(text, words, i, end))) {
        const first = words[i] as Word;
        const lastWord = words[end - 1] as Word;
        out += text.slice(last, first.start) + match.name;
        last = lastWord.end;
        i = end;
      } else {
        i++;
      }
    }
    return out + text.slice(last);
  };
}

/** Entradas do fixador a partir das personas (e do nome do app). */
export function nameEntries(
  personas: readonly { name: string; heardAs?: readonly string[] | undefined }[],
): NameEntry[] {
  return [STELLA_NAME, ...personas.map((p) => ({ name: p.name, heardAs: p.heardAs ?? [] }))];
}

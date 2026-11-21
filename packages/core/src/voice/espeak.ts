import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Phonemizer } from './sherpa.js';
import { VoiceModelError } from './config.js';

/**
 * Fonemas pelo espeak-ng, o mesmo com que as vozes (Kokoro e Piper) foram treinadas.
 * Roda como programa à parte (GPL-3): a Stella só manda o texto pela entrada padrão e lê
 * os fonemas, sem shell e sem argumentos vindos do texto.
 */
export interface EspeakOptions {
  /** Caminho do espeak-ng.exe. A pasta `espeak-ng-data` fica ao lado dele. */
  exe: string;
  /** Tempo máximo por frase. */
  timeoutMs?: number;
}

/** Pontuação que separa trechos (o espeak-ng devolve uma linha de fonemas por trecho). */
const CLAUSE_PUNCT = /[,;:.!?…]+/g;

/** Pontuação de cada trecho, na ordem ("Oi, tudo bem?" → [",", "?"]). */
export function clausePunctuation(text: string): string[] {
  const marks: string[] = [];
  for (const m of text.matchAll(CLAUSE_PUNCT)) {
    const after = text[m.index + m[0].length];
    // "3.5" e "1,5" não separam trechos.
    if (after !== undefined && /\S/.test(after) && /\d/.test(text[m.index - 1] ?? '')) continue;
    const mark = m[0].includes('?')
      ? '?'
      : m[0].includes('!')
        ? '!'
        : m[0][0] === '…'
          ? '.'
          : m[0][0];
    if (mark) marks.push(mark);
  }
  return marks;
}

/**
 * Junta as linhas de fonemas com a pontuação de volta (as vozes foram treinadas com ela:
 * vírgula vira pausa, "?" muda a entonação). Se o espeak-ng dividiu diferente, junta com
 * espaço e mantém só a pontuação final.
 */
export function joinClauses(lines: readonly string[], marks: readonly string[]): string {
  const clauses = lines.map((l) => l.trim()).filter(Boolean);
  if (clauses.length === 0) return '';
  if (clauses.length === marks.length || clauses.length === marks.length + 1) {
    return clauses
      .map((c, i) => (marks[i] ? `${c}${marks[i]}` : c))
      .join(' ')
      .trim();
  }
  const last = marks.at(-1) ?? '';
  return `${clauses.join(' ')}${last}`;
}

/** Roda o espeak-ng uma vez para o texto e devolve as linhas de fonemas (IPA). */
function run(exe: string, text: string, lang: string, timeoutMs: number): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, [`--path=${dirname(exe)}`, '-q', '--ipa', '-v', lang, '--stdin'], {
      windowsHide: true,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('O espeak-ng demorou demais para responder.'));
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d: string) => (out += d));
    child.stderr.on('data', (d: string) => (err += d));
    child.once('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`O espeak-ng falhou (${code}): ${err.trim()}`));
      else resolve(out.split(/\r?\n/));
    });
    // Uma linha só: quebras viram espaço (o texto nunca vira argumento do programa).
    child.stdin.end(`${text.replace(/\s+/g, ' ').trim()}\n`, 'utf8');
  });
}

/** Cria o fonetizador. Lança VoiceModelError se o espeak-ng não estiver instalado. */
export function createEspeakPhonemizer(options: EspeakOptions): Phonemizer {
  const { exe, timeoutMs = 5000 } = options;
  if (!existsSync(exe) || !existsSync(join(dirname(exe), 'espeak-ng-data'))) {
    throw new VoiceModelError(`espeak-ng não encontrado em ${exe}. Rode npm run models:pull.`, [
      exe,
    ]);
  }
  return async (text, lang) => {
    const lines = await run(exe, text, lang, timeoutMs);
    const phonemes = joinClauses(lines, clausePunctuation(text));
    return phonemes ? [phonemes] : [];
  };
}

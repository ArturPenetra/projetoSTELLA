import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AvatarDirector,
  DEFAULT_AVATAR_TIMINGS as T,
  PAGE_MAX_CHARS,
  paginate,
  type AvatarSnapshot,
} from './director.js';

const LONG =
  'Correr cinco quilômetros em dois meses é um ótimo objetivo. Primeiro, corra três vezes por semana, sempre no mesmo horário. Depois, aumente a distância aos poucos: meio quilômetro por semana já é bastante. Descanse bem entre os treinos e beba água. Se sentir dor, pare e respeite o seu corpo. No fim do segundo mês, você vai se surpreender com o quanto evoluiu. Quer que eu monte a primeira semana?';

describe('paginate', () => {
  it('texto curto vira uma página só, com espaços normalizados', () => {
    expect(paginate('  Oi!\n\nTudo   bem? ')).toEqual(['Oi! Tudo bem?']);
    expect(paginate('   ')).toEqual([]);
  });

  it('não perde nada: juntar as páginas devolve o texto inteiro', () => {
    const pages = paginate(LONG);
    expect(pages.length).toBeGreaterThan(2);
    expect(pages.join(' ')).toBe(LONG);
    for (const p of pages) expect(p.length).toBeLessThanOrEqual(PAGE_MAX_CHARS);
  });

  it('corta em fim de frase sempre que possível', () => {
    for (const p of paginate(LONG)) expect(p).toMatch(/[.!?]$/);
  });

  it('frase maior que a página é quebrada entre palavras, sem cortar palavra', () => {
    const sentence = Array.from({ length: 60 }, (_, i) => `palavra${i}`).join(' ') + '.';
    const pages = paginate(sentence, 50);
    expect(pages.join(' ')).toBe(sentence);
    for (const p of pages) {
      expect(p.length).toBeLessThanOrEqual(50);
      expect(p.split(' ').every((w) => /^palavra\d+\.?$/.test(w))).toBe(true);
    }
  });

  it('palavra gigante (um link) é partida para caber', () => {
    const url = 'https://exemplo.com/' + 'a'.repeat(300);
    const pages = paginate(url, 100);
    expect(pages.join('')).toBe(url);
    expect(pages.every((p) => p.length <= 100)).toBe(true);
  });
});

describe('AvatarDirector', () => {
  let seen: AvatarSnapshot[];
  let director: AvatarDirector;

  beforeEach(() => {
    vi.useFakeTimers();
    seen = [];
    director = new AvatarDirector((s) => seen.push(s));
  });
  afterEach(() => {
    director.dispose();
    vi.useRealTimers();
  });

  const moods = () => seen.map((s) => s.mood).filter((m, i, a) => m !== a[i - 1]);
  /** Todas as páginas que apareceram no balão, na ordem, sem repetir. */
  const shown = () =>
    seen
      .filter((s) => s.bubble && !s.typing)
      .reduce<string[]>((acc, s) => {
        if (s.page === acc.length) acc[acc.length - 1] = s.bubble as string;
        else if (s.page === acc.length + 1) acc.push(s.bubble as string);
        return acc;
      }, []);

  it('resposta curta: pensando, falando, feliz, parado e o balão some', () => {
    director.userSent();
    expect(director.snapshot).toMatchObject({ mood: 'pensando', typing: true });
    director.token('Oi!');
    director.token(' Tudo bem?');
    expect(director.snapshot).toMatchObject({
      mood: 'falando',
      bubble: 'Oi! Tudo bem?',
      page: 1,
      pages: 1,
    });
    director.done();
    expect(director.snapshot.mood).toBe('feliz');
    vi.advanceTimersByTime(T.happyMs);
    expect(director.snapshot).toMatchObject({ mood: 'parado', bubble: 'Oi! Tudo bem?' });
    vi.advanceTimersByTime(T.lastPageMinMs);
    expect(director.snapshot.bubble).toBeNull();
    expect(moods()).toEqual(['pensando', 'falando', 'feliz', 'parado']);
  });

  it('resposta longa: todas as páginas aparecem, em ordem, cada uma pelo tempo de leitura', () => {
    const pages = paginate(LONG);
    director.userSent();
    // Chega em pedaços pequenos, rápido (como o modelo real).
    for (const word of LONG.split(/(?<= )/)) director.token(word);
    director.done();

    expect(director.snapshot).toMatchObject({ page: 1, pages: pages.length, mood: 'falando' });
    // Enquanto há páginas, ela continua falando; só fica feliz na última.
    for (let i = 1; i < pages.length; i++) {
      vi.advanceTimersByTime(
        Math.max(
          T.pageMinMs,
          Math.min(T.pageMaxMs, (pages[i - 1] as string).length * T.pageMsPerChar),
        ),
      );
      expect(director.snapshot.page).toBe(i + 1);
    }
    expect(director.snapshot.mood).toBe('feliz');
    vi.advanceTimersByTime(T.lastPageMinMs + T.pageMaxMs);
    expect(director.snapshot.bubble).toBeNull();

    expect(shown()).toEqual(pages);
    expect(shown().join(' ')).toBe(LONG);
  });

  it('durante o streaming, a página só passa depois do tempo de leitura', () => {
    director.userSent();
    const pages = paginate(LONG);
    director.token(LONG.slice(0, 400));
    expect(director.snapshot.page).toBe(1);
    vi.advanceTimersByTime(T.pageMinMs - 1);
    expect(director.snapshot.page).toBe(1);
    vi.advanceTimersByTime(T.pageMaxMs);
    expect(director.snapshot.page).toBe(2);
    director.token(LONG.slice(400));
    director.done();
    vi.advanceTimersByTime(60_000);
    expect(shown()).toEqual(pages);
  });

  it('clicar no balão passa para a próxima página; na última, não', () => {
    director.say(LONG);
    const pages = paginate(LONG);
    expect(director.snapshot.page).toBe(1);
    for (let i = 2; i <= pages.length; i++) {
      expect(director.next()).toBe(true);
      expect(director.snapshot.page).toBe(i);
    }
    expect(director.next()).toBe(false);
    expect(director.snapshot.mood).toBe('feliz');
  });

  it('erro mostra a mensagem inteira e fica parado', () => {
    director.userSent();
    director.failed('Não consegui falar com o Ollama.');
    expect(director.snapshot).toMatchObject({
      mood: 'parado',
      bubble: 'Não consegui falar com o Ollama.',
    });
    vi.advanceTimersByTime(T.lastPageMinMs);
    expect(director.snapshot.bubble).toBeNull();
  });

  it('nova mensagem ou cancelamento interrompe as páginas', () => {
    director.say(LONG);
    director.userSent();
    vi.advanceTimersByTime(60_000);
    expect(director.snapshot).toMatchObject({ mood: 'pensando', typing: true });
    director.token('Começando');
    director.cancelled();
    expect(director.snapshot).toMatchObject({ mood: 'parado', bubble: null });
  });

  it('resposta vazia não fica feliz', () => {
    director.userSent();
    director.done();
    expect(director.snapshot).toMatchObject({ mood: 'parado', bubble: null });
  });

  it('say não interrompe uma resposta em andamento', () => {
    director.userSent();
    director.say('Interrompendo');
    expect(director.snapshot.mood).toBe('pensando');
    director.token('Resposta');
    director.say('Interrompendo');
    expect(director.snapshot.bubble).toBe('Resposta');
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AvatarDirector,
  BUBBLE_MAX_CHARS,
  DEFAULT_AVATAR_TIMINGS,
  fitBubble,
  type AvatarSnapshot,
} from './director.js';

describe('fitBubble', () => {
  it('mantém textos curtos e junta espaços', () => {
    expect(fitBubble('  Oi!\n\nTudo   bem? ', false)).toBe('Oi! Tudo bem?');
  });

  it('no streaming mostra o final do texto', () => {
    const text = 'a'.repeat(300) + ' fim';
    const fitted = fitBubble(text, true);
    expect(fitted.length).toBeLessThanOrEqual(BUBBLE_MAX_CHARS);
    expect(fitted.startsWith('…')).toBe(true);
    expect(fitted.endsWith('fim')).toBe(true);
  });

  it('no fim mostra o começo e corta numa palavra', () => {
    const text = Array.from({ length: 80 }, (_, i) => `palavra${i}`).join(' ');
    const fitted = fitBubble(text, false);
    expect(fitted.length).toBeLessThanOrEqual(BUBBLE_MAX_CHARS);
    expect(fitted.startsWith('palavra0 palavra1')).toBe(true);
    expect(fitted).toMatch(/palavra\d+…$/);
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

  const moods = () => seen.map((s) => s.mood);

  it('segue o chat: pensando, falando, feliz e parado', () => {
    director.userSent();
    expect(director.snapshot).toEqual({ mood: 'pensando', bubble: '', typing: true });

    director.token('Oi!');
    director.token(' Tudo bem?');
    expect(director.snapshot).toEqual({ mood: 'falando', bubble: 'Oi! Tudo bem?', typing: false });

    director.done();
    expect(director.snapshot.mood).toBe('feliz');
    expect(director.snapshot.bubble).toBe('Oi! Tudo bem?');

    vi.advanceTimersByTime(DEFAULT_AVATAR_TIMINGS.happyMs);
    expect(director.snapshot.mood).toBe('parado');
    expect(director.snapshot.bubble).toBe('Oi! Tudo bem?');

    vi.advanceTimersByTime(DEFAULT_AVATAR_TIMINGS.bubbleMinMs);
    expect(director.snapshot.bubble).toBeNull();
    expect(moods()).toEqual(['pensando', 'falando', 'falando', 'feliz', 'parado', 'parado']);
  });

  it('balão de resposta longa fica mais tempo, até o máximo', () => {
    director.userSent();
    director.token('x'.repeat(BUBBLE_MAX_CHARS));
    director.done();
    const expected = BUBBLE_MAX_CHARS * DEFAULT_AVATAR_TIMINGS.bubbleMsPerChar;
    vi.advanceTimersByTime(expected - 1);
    expect(director.snapshot.bubble).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(director.snapshot.bubble).toBeNull();
  });

  it('nova mensagem cancela os timers da anterior', () => {
    director.userSent();
    director.token('Primeira');
    director.done();
    director.userSent();
    vi.advanceTimersByTime(60_000);
    expect(director.snapshot).toEqual({ mood: 'pensando', bubble: '', typing: true });
  });

  it('erro mostra a mensagem e volta a ficar parado', () => {
    director.userSent();
    director.failed('Não consegui falar com o Ollama.');
    expect(director.snapshot).toEqual({
      mood: 'parado',
      bubble: 'Não consegui falar com o Ollama.',
      typing: false,
    });
    vi.advanceTimersByTime(DEFAULT_AVATAR_TIMINGS.bubbleMaxMs);
    expect(director.snapshot.bubble).toBeNull();
  });

  it('cancelar esconde o balão na hora', () => {
    director.userSent();
    director.token('Começando');
    director.cancelled();
    expect(director.snapshot).toEqual({ mood: 'parado', bubble: null, typing: false });
  });

  it('resposta vazia não fica feliz', () => {
    director.userSent();
    director.done();
    expect(director.snapshot).toEqual({ mood: 'parado', bubble: null, typing: false });
  });

  it('say não interrompe uma resposta em andamento', () => {
    director.say('Oi! Clique em mim para conversar.');
    expect(director.snapshot.mood).toBe('feliz');
    director.userSent();
    director.say('Interrompendo');
    expect(director.snapshot.mood).toBe('pensando');
    director.token('Resposta');
    director.say('Interrompendo');
    expect(director.snapshot.bubble).toBe('Resposta');
  });

  it('não avisa quando nada mudou', () => {
    director.cancelled();
    director.cancelled();
    expect(seen).toEqual([]);
  });
});

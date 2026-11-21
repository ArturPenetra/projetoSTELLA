import { describe, expect, it } from 'vitest';
import { SentenceSplitter, speakable } from './sentences.js';

/** Manda o texto em pedaços pequenos, como o modelo faz, e junta o que sai. */
function split(text: string, size = 3, options = {}): string[] {
  const s = new SentenceSplitter(options);
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(...s.push(text.slice(i, i + size)));
  return [...out, ...s.flush()];
}

describe('SentenceSplitter', () => {
  it('solta cada frase assim que ela termina', () => {
    const s = new SentenceSplitter();
    expect(s.push('Oi! Tudo')).toEqual(['Oi!']);
    expect(s.push(' bem com você? Que')).toEqual(['Tudo bem com você?']);
    expect(s.flush()).toEqual(['Que']);
  });

  it('o primeiro pedaço pode parar na vírgula, para a voz começar antes', () => {
    expect(
      split(
        'Que legal que você conseguiu terminar, isso merece comemorar. Vamos, então, planejar?',
      ),
    ).toEqual([
      'Que legal que você conseguiu terminar,',
      'isso merece comemorar.',
      'Vamos, então, planejar?',
    ]);
  });

  it('primeira frase longa sem pontuação: corta antes de "quando", "que"...', () => {
    expect(
      split('Tô animado quando imagina um final de semana cheio de coisas boas! Bora planejar?'),
    ).toEqual([
      'Tô animado',
      'quando imagina um final de semana cheio de coisas boas!',
      'Bora planejar?',
    ]);
  });

  it('sem palavra boa para a pausa, corta no último espaço antes do limite', () => {
    const out = split('Estudar muito cansa bastante mesmo ainda mais sem dormir direito hoje.');
    expect(out[0]).toBe('Estudar muito cansa bastante mesmo');
    expect(out.join(' ')).toBe(
      'Estudar muito cansa bastante mesmo ainda mais sem dormir direito hoje.',
    );
  });

  it('só a primeira frase é cortada assim', () => {
    expect(split('Oi! Estudar muito cansa bastante mesmo ainda mais sem dormir direito.')).toEqual([
      'Oi!',
      'Estudar muito cansa bastante mesmo ainda mais sem dormir direito.',
    ]);
  });

  it('vírgula cedo demais não corta', () => {
    expect(split('Sim, claro. Pode ser.')).toEqual(['Sim, claro.', 'Pode ser.']);
  });

  it('não corta em números, abreviações nem reticências no meio', () => {
    expect(split('O Dr. Silva chega às 3.5 horas... ou não. Fim')).toEqual([
      'O Dr. Silva chega às 3.5 horas...',
      'ou não.',
      'Fim',
    ]);
  });

  it('quebra de linha separa itens de lista', () => {
    expect(split('Hoje:\n- pão\n- café\nPronto.')).toEqual(['Hoje:', '- pão', '- café', 'Pronto.']);
  });

  it('frase longa sem pontuação é cortada na última vírgula antes do limite', () => {
    const long = `${'palavra '.repeat(10)}fim, ${'outra '.repeat(10)}`;
    const out = split(long, 5, { maxChars: 100, firstMaxChars: 1000 });
    expect(out[0]?.endsWith('fim,')).toBe(true);
    expect(out.join(' ').replace(/\s+/g, ' ')).toBe(long.trim().replace(/\s+/g, ' '));
  });

  it('nada de texto se perde', () => {
    const text = 'Primeira frase. Segunda, com vírgula! Terceira? E a última sem ponto';
    expect(split(text, 2).join(' ')).toBe(text);
  });
});

describe('speakable', () => {
  it('tira emojis, marcações e links', () => {
    expect(speakable('**Ótimo!** 🎉 Veja https://exemplo.com agora 👍🏽')).toBe('Ótimo! Veja agora');
    expect(speakable('- item da lista')).toBe('item da lista');
  });

  it('sem letras nem números, não há o que falar', () => {
    expect(speakable('🎉🎉 ...')).toBe('');
    expect(speakable('  ')).toBe('');
  });
});

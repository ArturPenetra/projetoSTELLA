import { describe, expect, it } from 'vitest';
import { voiceLabel } from './voice-ui.js';

describe('voiceLabel', () => {
  it('desligada: sem faixa', () => {
    expect(voiceLabel({ status: 'off' }, 'Leo')).toBeUndefined();
  });

  it('cada estado diz o que está acontecendo, com o nome da persona', () => {
    expect(voiceLabel({ status: 'listening' }, 'Leo')).toBe('Ouvindo… pode falar.');
    expect(voiceLabel({ status: 'thinking' }, 'Leo')).toBe('Leo está pensando…');
    expect(voiceLabel({ status: 'speaking' }, 'Pixi')).toBe('Pixi está falando · Esc interrompe');
    expect(voiceLabel({ status: 'loading' }, 'Leo')).toMatch(/^Carregando a voz/);
  });

  it('erro mostra o motivo', () => {
    expect(voiceLabel({ status: 'error', error: 'Microfone negado.' }, 'Leo')).toBe(
      'Não deu para ligar a voz: Microfone negado.',
    );
  });
});

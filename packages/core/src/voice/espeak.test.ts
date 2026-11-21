import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { VoiceModelError } from './config.js';
import { clausePunctuation, createEspeakPhonemizer, joinClauses } from './espeak.js';

describe('pontuação dos trechos', () => {
  it('acha a pontuação de cada trecho, na ordem', () => {
    expect(clausePunctuation('Oi, Stella! Tudo bem? Sim.')).toEqual([',', '!', '?', '.']);
    expect(clausePunctuation('Será?! Hum... ok')).toEqual(['?', '.']);
  });

  it('números com ponto ou vírgula não separam trechos', () => {
    expect(clausePunctuation('São 3.5 horas, ou 1,5 dia.')).toEqual([',', '.']);
  });

  it('junta os fonemas com a pontuação de volta', () => {
    expect(joinClauses(['ˈoɪ', 'stˈɛlæ', ''], [',', '!'])).toBe('ˈoɪ, stˈɛlæ!');
    // Último trecho sem pontuação.
    expect(joinClauses(['ˈoɪ', 'tˈudʊ'], [','])).toBe('ˈoɪ, tˈudʊ');
  });

  it('se o espeak-ng dividiu diferente, junta com espaço e mantém a pontuação final', () => {
    expect(joinClauses(['a', 'b', 'c', 'd'], [','])).toBe('a b c d,');
    expect(joinClauses([], ['.'])).toBe('');
  });
});

const ROOT = join(import.meta.dirname, '../../../..');
const ESPEAK = [
  process.env['STELLA_ESPEAK'],
  join(ROOT, 'models/voz/espeak-ng/eSpeak NG/espeak-ng.exe'),
  'D:/Ferramentas/espeak-ng/eSpeak NG/espeak-ng.exe',
].find((p): p is string => !!p && existsSync(p));

describe('createEspeakPhonemizer', () => {
  it('sem o espeak-ng, explica como instalar', () => {
    expect(() => createEspeakPhonemizer({ exe: join(ROOT, 'nao-existe/espeak-ng.exe') })).toThrow(
      VoiceModelError,
    );
  });

  describe.skipIf(!ESPEAK)('com o espeak-ng de verdade', () => {
    const phonemize = ESPEAK ? createEspeakPhonemizer({ exe: ESPEAK }) : undefined;

    it('fonemas em pt-BR, com acentos nasais e a pontuação', async () => {
      const [ipa] = (await phonemize?.('Oi, você está bem? São três horas.', 'pt-br')) ?? [];
      expect(ipa).toMatch(/^ˈoɪ, /);
      expect(ipa).toContain('?');
      expect(ipa?.endsWith('.')).toBe(true);
      expect(ipa?.normalize('NFD')).toContain('\u0303'); // "São": vogal nasal
    });

    it('o texto nunca vira argumento: aspas e traços são só texto', async () => {
      const [ipa] = (await phonemize?.('--version "-v en" ; echo oi', 'pt-br')) ?? [];
      expect(ipa).toBeTruthy();
    });

    it('texto vazio não gera fonemas', async () => {
      expect(await phonemize?.('   ', 'pt-br')).toEqual([]);
    });
  });
});

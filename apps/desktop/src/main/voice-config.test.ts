import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { espeakPath, voiceForPersona, voiceModelsDir } from './voice-config.js';

describe('voiceForPersona', () => {
  it('usa a voz e a velocidade do persona.json', () => {
    expect(
      voiceForPersona({ gender: 'masculine', voice: { voiceId: 'pm_santa', speed: 1.1 } }),
    ).toEqual({ sid: 44, speed: 1.1 });
  });

  it('voz desconhecida ou "definir": usa a padrão do gênero', () => {
    expect(
      voiceForPersona({ gender: 'masculine', voice: { voiceId: 'definir', speed: 1 } }).sid,
    ).toBe(43);
    expect(voiceForPersona({ gender: 'feminine' })).toEqual({ sid: 42, speed: 1 });
    expect(voiceForPersona(undefined)).toEqual({ sid: 42, speed: 1 });
  });

  it('velocidade fica entre 0,5 e 2', () => {
    expect(
      voiceForPersona({ gender: 'feminine', voice: { voiceId: 'pf_dora', speed: 3 } }).speed,
    ).toBe(2);
  });
});

describe('pastas', () => {
  it('modelos em models/voz, ou onde a variável mandar', () => {
    expect(voiceModelsDir('D:/Stella', {})).toBe(join('D:/Stella', 'models', 'voz'));
    expect(voiceModelsDir('D:/Stella', { STELLA_VOICE_MODELS: 'E:/voz' })).toBe('E:/voz');
  });

  it('espeak-ng ao lado dos modelos', () => {
    expect(espeakPath('D:/voz', {})).toBe(
      join('D:/voz', 'espeak-ng', 'eSpeak NG', 'espeak-ng.exe'),
    );
  });
});

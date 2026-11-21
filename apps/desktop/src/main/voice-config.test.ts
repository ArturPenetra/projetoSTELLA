import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { VOICE_MODELS, voiceForPersona, voiceModelsDir } from './voice-config.js';

describe('voiceForPersona', () => {
  it('usa a voz e a velocidade do persona.json', () => {
    expect(voiceForPersona({ gender: 'masculine', voice: { voiceId: 'M1', speed: 1.15 } })).toEqual(
      { sid: 5, speed: 1.15 },
    );
    expect(voiceForPersona({ gender: 'feminine', voice: { voiceId: 'F3', speed: 1 } }).sid).toBe(2);
  });

  it('voz desconhecida ou "definir": usa a padrão do gênero', () => {
    expect(
      voiceForPersona({ gender: 'masculine', voice: { voiceId: 'definir', speed: 1 } }).sid,
    ).toBe(5);
    expect(voiceForPersona({ gender: 'feminine' })).toEqual({ sid: 0, speed: 1 });
    expect(voiceForPersona(undefined)).toEqual({ sid: 0, speed: 1 });
  });

  it('velocidade fica entre 0,5 e 2', () => {
    expect(voiceForPersona({ gender: 'feminine', voice: { voiceId: 'F2', speed: 3 } }).speed).toBe(
      2,
    );
  });
});

describe('modelos', () => {
  it('a voz é o Supertonic 3, que não precisa do espeak-ng', () => {
    expect(VOICE_MODELS.tts.kind).toBe('supertonic');
  });

  it('modelos em models/voz, ou onde a variável mandar', () => {
    expect(voiceModelsDir('D:/Stella', {})).toBe(join('D:/Stella', 'models', 'voz'));
    expect(voiceModelsDir('D:/Stella', { STELLA_VOICE_MODELS: 'E:/voz' })).toBe('E:/voz');
  });
});

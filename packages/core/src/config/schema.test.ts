import { describe, expect, it } from 'vitest';
import { ConfigError, DEFAULT_CHAT_MODEL, defaultConfig, parseConfig } from './schema.js';

describe('parseConfig', () => {
  it('preenche os padrões a partir de um objeto vazio', () => {
    const config = defaultConfig();
    expect(config.llm.baseUrl).toBe('http://127.0.0.1:11434');
    expect(config.llm.model).toBe(DEFAULT_CHAT_MODEL);
    expect(config.llm.think).toBe(false);
    expect(config.ui.language).toBe('pt-BR');
  });

  it('aceita outro modelo e porta local', () => {
    const config = parseConfig({
      llm: { model: 'qwen3.5:4b', baseUrl: 'http://localhost:11435/' },
    });
    expect(config.llm.model).toBe('qwen3.5:4b');
    expect(config.llm.baseUrl).toBe('http://localhost:11435');
  });

  it('recusa endereço fora do computador', () => {
    expect(() => parseConfig({ llm: { baseUrl: 'https://api.exemplo.com' } })).toThrow(ConfigError);
    expect(() => parseConfig({ llm: { baseUrl: 'http://0.0.0.0:11434' } })).toThrow(/100% local/);
  });

  it('recusa valores fora da faixa com mensagem que aponta o campo', () => {
    try {
      parseConfig({ llm: { temperature: 5 } });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect((err as ConfigError).issues[0]).toMatch(/^llm\.temperature:/);
    }
  });
});

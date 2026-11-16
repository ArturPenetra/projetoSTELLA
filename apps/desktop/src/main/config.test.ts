import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'stella-config-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('loadConfig', () => {
  it('cria config.json com os padrões na primeira vez', async () => {
    const { config, warning } = await loadConfig(dir);
    expect(warning).toBeUndefined();
    expect(config.llm.model).toBe('qwen3.5:2b');
    const saved = JSON.parse(await readFile(join(dir, 'config.json'), 'utf8'));
    expect(saved.llm.baseUrl).toBe('http://127.0.0.1:11434');
  });

  it('lê valores salvos', async () => {
    await writeFile(join(dir, 'config.json'), JSON.stringify({ llm: { model: 'qwen3.5:4b' } }));
    const { config } = await loadConfig(dir);
    expect(config.llm.model).toBe('qwen3.5:4b');
  });

  it('usa os padrões e avisa quando o arquivo aponta para fora do computador', async () => {
    await writeFile(
      join(dir, 'config.json'),
      JSON.stringify({ llm: { baseUrl: 'https://servidor.remoto' } }),
    );
    const { config, warning } = await loadConfig(dir);
    expect(config.llm.baseUrl).toBe('http://127.0.0.1:11434');
    expect(warning).toMatch(/100% local/);
  });

  it('usa os padrões quando o JSON está quebrado', async () => {
    await writeFile(join(dir, 'config.json'), '{ isto não é json');
    const { config, warning } = await loadConfig(dir);
    expect(config.llm.model).toBe('qwen3.5:2b');
    expect(warning).toMatch(/JSON/);
  });
});

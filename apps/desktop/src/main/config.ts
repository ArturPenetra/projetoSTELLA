import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { ConfigError, defaultConfig, parseConfig, type AppConfig } from '@stella/core';

export interface LoadedConfig {
  config: AppConfig;
  path: string;
  /** Problemas encontrados no arquivo; nesse caso, os padrões foram usados. */
  warning?: string;
}

/** Lê config.json da pasta de dados do usuário. Cria o arquivo com os padrões se não existir. */
export async function loadConfig(userDataDir: string): Promise<LoadedConfig> {
  const path = join(userDataDir, 'config.json');
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    const config = defaultConfig();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(config, null, 2) + '\n', 'utf8');
    return { config, path };
  }

  try {
    return { config: parseConfig(JSON.parse(text)), path };
  } catch (err) {
    const detail = err instanceof ConfigError ? err.message : 'o arquivo não é um JSON válido.';
    return {
      config: defaultConfig(),
      path,
      warning: `Ignorei ${path} e usei os padrões. ${detail}`,
    };
  }
}

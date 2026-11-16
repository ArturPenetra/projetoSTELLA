import { z } from 'zod';
import { isLoopbackUrl } from '../network-policy.js';

export const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';
export const DEFAULT_CHAT_MODEL = 'qwen3.5:2b';

const loopbackUrl = z
  .string()
  .trim()
  .refine(isLoopbackUrl, {
    message: 'A Stella roda 100% local: o endereço do Ollama precisa ser 127.0.0.1 ou localhost.',
  })
  .transform((url) => url.replace(/\/+$/, ''));

export const llmConfigSchema = z.object({
  baseUrl: loopbackUrl.default(DEFAULT_OLLAMA_URL),
  model: z.string().trim().min(1).default(DEFAULT_CHAT_MODEL),
  temperature: z.number().min(0).max(2).default(0.8),
  /** Tamanho do contexto em tokens. 8K cabe bem numa GPU de 6 GB com o modelo 2B. */
  contextSize: z.number().int().min(2048).max(131072).default(8192),
  /** Modelos com raciocínio (Qwen3.5) respondem mais rápido sem o modo "pensar". */
  think: z.boolean().default(false),
});

export const appConfigSchema = z.object({
  llm: llmConfigSchema.prefault({}),
  ui: z
    .object({
      language: z.enum(['pt-BR', 'en']).default('pt-BR'),
    })
    .prefault({}),
});

export type LlmConfig = z.infer<typeof llmConfigSchema>;
export type AppConfig = z.infer<typeof appConfigSchema>;

export class ConfigError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Configuração inválida:\n- ${issues.join('\n- ')}`);
    this.name = 'ConfigError';
  }
}

/** Valida a configuração lida do disco, preenchendo os valores padrão. */
export function parseConfig(raw: unknown): AppConfig {
  const result = appConfigSchema.safeParse(raw ?? {});
  if (!result.success) {
    throw new ConfigError(
      result.error.issues.map((i) => `${i.path.join('.') || '(raiz)'}: ${i.message}`),
    );
  }
  return result.data;
}

export function defaultConfig(): AppConfig {
  return parseConfig({});
}

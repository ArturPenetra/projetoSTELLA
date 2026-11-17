import { z } from 'zod';
import { isLoopbackUrl } from '../network-policy.js';
import type { LlmConfig } from '../config/schema.js';
import { LlmError, isAbortError } from './errors.js';
import { readNdjson } from './ndjson.js';
import type {
  ChatChunk,
  ChatMessage,
  ChatOptions,
  CompleteOptions,
  Completer,
  Embedder,
  LlmClient,
  LlmStatus,
} from './types.js';

const STATUS_TIMEOUT_MS = 3000;

const chatLineSchema = z.object({
  message: z.object({ content: z.string().optional() }).optional(),
  done: z.boolean().optional(),
  error: z.string().optional(),
  eval_count: z.number().optional(),
  total_duration: z.number().optional(),
});

const completeSchema = z.object({
  message: z.object({ content: z.string() }),
});
const embedSchema = z.object({ embeddings: z.array(z.array(z.number())) });

const versionSchema = z.object({ version: z.string() });
const tagsSchema = z.object({
  models: z.array(z.object({ name: z.string(), digest: z.string().optional() })),
});
const errorBodySchema = z.object({ error: z.string() });

export type OllamaClientOptions = Pick<LlmConfig, 'baseUrl' | 'model'> &
  Partial<Pick<LlmConfig, 'temperature' | 'contextSize' | 'think'>> & {
    fetch?: typeof fetch;
  };

/** Cliente do Ollama local (`/api/chat` com streaming). Só aceita endereços de loopback. */
export class OllamaClient implements LlmClient, Completer, Embedder {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: OllamaClientOptions) {
    if (!isLoopbackUrl(options.baseUrl)) {
      throw new LlmError(
        'unavailable',
        `Endereço recusado: ${options.baseUrl}. A Stella só conversa com o Ollama local.`,
      );
    }
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  get model(): string {
    return this.options.model;
  }

  async status(): Promise<LlmStatus> {
    try {
      const signal = AbortSignal.timeout(STATUS_TIMEOUT_MS);
      const versionRes = await this.fetchImpl(`${this.baseUrl}/api/version`, { signal });
      if (!versionRes.ok) throw new Error(`HTTP ${versionRes.status}`);
      const { version } = versionSchema.parse(await versionRes.json());

      const tagsRes = await this.fetchImpl(`${this.baseUrl}/api/tags`, { signal });
      if (!tagsRes.ok) throw new Error(`HTTP ${tagsRes.status}`);
      const { models } = tagsSchema.parse(await tagsRes.json());
      const installed = models.some((m) => sameModel(m.name, this.model));

      return { state: installed ? 'ready' : 'model_missing', version, model: this.model };
    } catch (err) {
      return { state: 'unavailable', message: LlmError.unavailable(this.baseUrl, err).message };
    }
  }

  async *chat(messages: ChatMessage[], options: ChatOptions = {}): AsyncGenerator<ChatChunk> {
    const { signal } = options;
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          messages,
          stream: true,
          think: this.options.think ?? false,
          options: {
            temperature: this.options.temperature ?? 0.8,
            num_ctx: this.options.contextSize ?? 8192,
          },
        }),
        ...(signal ? { signal } : {}),
      });
    } catch (err) {
      if (signal?.aborted || isAbortError(err)) throw LlmError.aborted();
      throw LlmError.unavailable(this.baseUrl, err);
    }

    if (!res.ok || !res.body) {
      throw await this.httpError(res);
    }

    try {
      for await (const raw of readNdjson(res.body)) {
        const parsed = chatLineSchema.safeParse(raw);
        if (!parsed.success) {
          throw new LlmError('bad_response', 'O Ollama mandou uma resposta em formato inesperado.');
        }
        const line = parsed.data;
        if (line.error) throw new LlmError('http', `Erro do Ollama: ${line.error}`);
        const text = line.message?.content;
        if (text) yield { type: 'token', text };
        if (line.done) {
          yield {
            type: 'done',
            stats: {
              ...(line.eval_count !== undefined ? { outputTokens: line.eval_count } : {}),
              ...(line.total_duration !== undefined
                ? { totalMs: Math.round(line.total_duration / 1e6) }
                : {}),
            },
          };
          return;
        }
      }
    } catch (err) {
      if (err instanceof LlmError) throw err;
      if (signal?.aborted || isAbortError(err)) throw LlmError.aborted();
      if (err instanceof SyntaxError) {
        throw new LlmError('bad_response', 'O Ollama mandou uma resposta incompleta.', {
          cause: err,
        });
      }
      throw LlmError.unavailable(this.baseUrl, err);
    }
    throw new LlmError('bad_response', 'A resposta do Ollama terminou antes do fim.');
  }

  /** Resposta inteira de uma vez, opcionalmente presa a um esquema JSON. */
  async complete(messages: ChatMessage[], options: CompleteOptions = {}): Promise<string> {
    const body = await this.postJson(
      '/api/chat',
      {
        model: this.model,
        messages,
        stream: false,
        think: false,
        ...(options.format ? { format: options.format } : {}),
        options: {
          temperature: options.temperature ?? 0,
          num_ctx: this.options.contextSize ?? 8192,
        },
      },
      options.signal,
    );
    const parsed = completeSchema.safeParse(body);
    if (!parsed.success) {
      throw new LlmError('bad_response', 'O Ollama mandou uma resposta em formato inesperado.');
    }
    return parsed.data.message.content;
  }

  /** Embeddings de vários textos numa chamada só (`/api/embed`). */
  async embed(texts: string[], signal?: AbortSignal): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    // Mantém o modelo de embedding carregado por mais tempo: a frio ele demora segundos.
    const body = await this.postJson(
      '/api/embed',
      { model: this.model, input: texts, keep_alive: '30m' },
      signal,
    );
    const parsed = embedSchema.safeParse(body);
    if (!parsed.success || parsed.data.embeddings.length !== texts.length) {
      throw new LlmError('bad_response', 'O Ollama mandou embeddings em formato inesperado.');
    }
    return parsed.data.embeddings.map((v) => Float32Array.from(v));
  }

  private async postJson(path: string, payload: unknown, signal?: AbortSignal): Promise<unknown> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        ...(signal ? { signal } : {}),
      });
    } catch (err) {
      if (signal?.aborted || isAbortError(err)) throw LlmError.aborted();
      throw LlmError.unavailable(this.baseUrl, err);
    }
    if (!res.ok) throw await this.httpError(res);
    try {
      return await res.json();
    } catch (err) {
      if (signal?.aborted || isAbortError(err)) throw LlmError.aborted();
      throw new LlmError('bad_response', 'O Ollama mandou uma resposta incompleta.', {
        cause: err,
      });
    }
  }

  private async httpError(res: Response): Promise<LlmError> {
    let detail = '';
    try {
      const body = errorBodySchema.safeParse(await res.json());
      if (body.success) detail = body.data.error;
    } catch {
      // corpo vazio ou não-JSON
    }
    if (res.status === 404 && /not found/i.test(detail)) return LlmError.modelMissing(this.model);
    return new LlmError(
      'http',
      `O Ollama respondeu com erro ${res.status}${detail ? `: ${detail}` : ''}.`,
    );
  }
}

/** "qwen3.5:2b" casa com "qwen3.5:2b"; "bge-m3" casa com "bge-m3:latest". */
export function sameModel(installed: string, wanted: string): boolean {
  const norm = (name: string) => (name.includes(':') ? name : `${name}:latest`);
  return norm(installed) === norm(wanted);
}

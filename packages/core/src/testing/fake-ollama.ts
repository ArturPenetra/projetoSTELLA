import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FakeOllamaOptions {
  version?: string;
  models?: string[];
  /** Pedaços de texto devolvidos em streaming por /api/chat. */
  reply?: string[];
  /** Espera entre pedaços, em ms. */
  delayMs?: number;
  /** Espera antes do primeiro pedaço (o modelo "pensando"), em ms. */
  firstDelayMs?: number;
  /**
   * Resposta de /api/chat sem streaming (stream: false), usada na extração de fatos.
   * Recebe o corpo do pedido e devolve o texto da resposta. Padrão: `{"facts":[]}`.
   */
  complete?: (body: FakeChatRequest) => string;
  /** Vetor de um texto em /api/embed. Padrão: `bagOfWordsEmbedding`. */
  embed?: (text: string) => number[];
  /** Comportamento especial do /api/chat. */
  chatMode?: 'ok' | 'error-line' | 'truncated' | 'garbage' | 'http-500';
}

export interface FakeChatRequest {
  model?: string;
  stream?: boolean;
  format?: unknown;
  messages: { role: string; content: string }[];
}

export interface FakeOllama {
  url: string;
  /** Corpos JSON recebidos em /api/chat com streaming (as conversas). */
  requests: FakeChatRequest[];
  /** Corpos JSON recebidos em /api/chat sem streaming (tarefas internas). */
  completions: FakeChatRequest[];
  /** Textos recebidos em /api/embed. */
  embedded: string[];
  close(): Promise<void>;
}

/** Servidor que imita a API do Ollama, para testes. Escuta só em 127.0.0.1. */
export async function startFakeOllama(options: FakeOllamaOptions = {}): Promise<FakeOllama> {
  const {
    version = '0.40.16',
    models = ['qwen3.5:2b', 'bge-m3'],
    reply = ['Olá', ', tudo', ' bem?'],
    delayMs = 0,
    firstDelayMs = 0,
    chatMode = 'ok',
    complete = () => JSON.stringify({ facts: [] }),
    embed = bagOfWordsEmbedding,
  } = options;
  const requests: FakeChatRequest[] = [];
  const completions: FakeChatRequest[] = [];
  const embedded: string[] = [];

  const server: Server = createServer((req, res) => {
    void handle(req, res).catch(() => res.destroy());
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method === 'GET' && req.url === '/api/version') {
      return json(res, 200, { version });
    }
    if (req.method === 'GET' && req.url === '/api/tags') {
      return json(res, 200, { models: models.map((name) => ({ name, digest: `sha-${name}` })) });
    }
    if (req.method === 'POST' && req.url === '/api/embed') {
      const body = JSON.parse(await readBody(req)) as { model?: string; input: string[] };
      if (!models.includes(body.model ?? '')) {
        return json(res, 404, { error: `model "${body.model}" not found, try pulling it first` });
      }
      embedded.push(...body.input);
      return json(res, 200, { model: body.model, embeddings: body.input.map(embed) });
    }
    if (req.method === 'POST' && req.url === '/api/chat') {
      const body = JSON.parse(await readBody(req)) as FakeChatRequest;
      if (body.stream === false) {
        completions.push(body);
        if (!models.includes(body.model ?? '')) {
          return json(res, 404, { error: `model "${body.model}" not found, try pulling it first` });
        }
        return json(res, 200, {
          message: { role: 'assistant', content: complete(body) },
          done: true,
        });
      }
      requests.push(body);
      if (chatMode === 'http-500') return json(res, 500, { error: 'falha interna' });
      if (!models.includes(body.model ?? '')) {
        return json(res, 404, { error: `model "${body.model}" not found, try pulling it first` });
      }
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      if (chatMode === 'garbage') {
        res.end('isto não é json\n');
        return;
      }
      if (firstDelayMs) await sleep(firstDelayMs);
      for (const piece of reply) {
        if (res.destroyed) return;
        res.write(
          JSON.stringify({ message: { role: 'assistant', content: piece }, done: false }) + '\n',
        );
        if (delayMs) await sleep(delayMs);
      }
      if (chatMode === 'error-line') {
        res.end(JSON.stringify({ error: 'sem memória' }) + '\n');
        return;
      }
      if (chatMode === 'truncated') {
        res.end();
        return;
      }
      res.end(
        JSON.stringify({
          message: { role: 'assistant', content: '' },
          done: true,
          eval_count: reply.length,
          total_duration: 2_500_000,
        }) + '\n',
      );
      return;
    }
    json(res, 404, { error: 'rota desconhecida' });
  }

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    completions,
    embedded,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => (data += chunk));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Dimensão dos vetores do embedding falso. */
export const FAKE_EMBEDDING_DIM = 64;

/**
 * Embedding falso e determinístico: conta as palavras (sem acento, minúsculas) em
 * `FAKE_EMBEDDING_DIM` posições. Textos com palavras em comum ficam parecidos.
 */
export function bagOfWordsEmbedding(text: string): number[] {
  const v = new Array<number>(FAKE_EMBEDDING_DIM).fill(0);
  const words = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .match(/[a-z0-9]+/g) ?? ['vazio'];
  for (const w of words) {
    let h = 2166136261;
    for (const ch of w) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    const i = (h >>> 0) % FAKE_EMBEDDING_DIM;
    v[i] = (v[i] ?? 0) + 1;
  }
  return v;
}

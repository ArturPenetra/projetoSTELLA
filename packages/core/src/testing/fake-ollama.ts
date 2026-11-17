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
  /** Comportamento especial do /api/chat. */
  chatMode?: 'ok' | 'error-line' | 'truncated' | 'garbage' | 'http-500';
}

export interface FakeOllama {
  url: string;
  /** Corpos JSON recebidos em /api/chat. */
  requests: unknown[];
  close(): Promise<void>;
}

/** Servidor que imita a API do Ollama, para testes. Escuta só em 127.0.0.1. */
export async function startFakeOllama(options: FakeOllamaOptions = {}): Promise<FakeOllama> {
  const {
    version = '0.40.16',
    models = ['qwen3.5:2b'],
    reply = ['Olá', ', tudo', ' bem?'],
    delayMs = 0,
    firstDelayMs = 0,
    chatMode = 'ok',
  } = options;
  const requests: unknown[] = [];

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
    if (req.method === 'POST' && req.url === '/api/chat') {
      const body = JSON.parse(await readBody(req)) as { model?: string };
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

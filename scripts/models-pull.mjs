// Baixa os modelos da Stella pelo Ollama local e confere o digest contra config/models.lock.json.
// Uso:
//   npm run models:pull                    baixa os modelos do lock e confere os digests
//   npm run models:pull -- qwen3.5:4b      baixa também um modelo extra (não entra no lock)
//   npm run models:pull -- --update-lock   grava no lock os digests baixados
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const LOCK_PATH = fileURLToPath(new URL('../config/models.lock.json', import.meta.url));
const BASE_URL = (process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434').replace(/\/+$/, '');

function assertLoopback(url) {
  const { hostname } = new URL(url);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(hostname)) {
    throw new Error(`Endereço recusado: ${url}. Use o Ollama local (127.0.0.1).`);
  }
}

const norm = (name) => (name.includes(':') ? name : `${name}:latest`);

async function installedModels() {
  const res = await fetch(`${BASE_URL}/api/tags`);
  if (!res.ok) throw new Error(`Ollama respondeu ${res.status} em /api/tags`);
  const { models } = await res.json();
  return new Map(models.map((m) => [norm(m.name), m.digest]));
}

async function pull(name) {
  const res = await fetch(`${BASE_URL}/api/pull`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: name, stream: true }),
  });
  if (!res.ok || !res.body) throw new Error(`Falha ao baixar ${name}: HTTP ${res.status}`);

  const decoder = new TextDecoder();
  let buffer = '';
  let lastLine = '';
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i).trim();
      buffer = buffer.slice(i + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg.error) throw new Error(`Falha ao baixar ${name}: ${msg.error}`);
      const pct = msg.total ? ` ${Math.floor(((msg.completed ?? 0) / msg.total) * 100)}%` : '';
      const text = `  ${name}: ${msg.status}${pct}`;
      if (text !== lastLine) {
        process.stdout.write(`\r${text.padEnd(70)}`);
        lastLine = text;
      }
    }
  }
  process.stdout.write('\n');
}

async function main() {
  assertLoopback(BASE_URL);
  const args = process.argv.slice(2);
  const updateLock = args.includes('--update-lock');
  const extras = args.filter((a) => !a.startsWith('--'));

  try {
    const res = await fetch(`${BASE_URL}/api/version`, { signal: AbortSignal.timeout(3000) });
    const { version } = await res.json();
    console.log(`Ollama ${version} em ${BASE_URL}`);
  } catch {
    console.error(`Não consegui falar com o Ollama em ${BASE_URL}. Abra o Ollama e tente de novo.`);
    process.exit(1);
  }

  const lock = JSON.parse(await readFile(LOCK_PATH, 'utf8'));
  const wanted = [...lock.models.map((m) => m.name), ...extras];
  let installed = await installedModels();

  for (const name of wanted) {
    if (installed.has(norm(name))) {
      console.log(`  ${name}: já instalado`);
    } else {
      console.log(`Baixando ${name}...`);
      await pull(name);
    }
  }
  installed = await installedModels();

  let mismatch = false;
  for (const entry of lock.models) {
    const digest = installed.get(norm(entry.name));
    if (!digest) {
      console.error(`  ${entry.name}: não aparece no Ollama depois do download.`);
      mismatch = true;
    } else if (entry.digest === null || updateLock) {
      entry.digest = digest;
    } else if (entry.digest !== digest) {
      console.error(
        `  ${entry.name}: digest diferente do lock.\n    esperado ${entry.digest}\n    instalado ${digest}`,
      );
      mismatch = true;
    } else {
      console.log(`  ${entry.name}: digest confere`);
    }
  }

  await writeFile(LOCK_PATH, JSON.stringify(lock, null, 2) + '\n');
  if (mismatch) {
    console.error(
      'Algum modelo não confere com o lock. Use --update-lock só se a troca foi intencional.',
    );
    process.exit(1);
  }
  console.log('Modelos prontos.');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

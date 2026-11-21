// Baixa os modelos de voz (reconhecimento, síntese e VAD) uma vez só, confere o SHA-256
// fixado em config/models.lock.json e extrai em models/voz (ou em STELLA_VOICE_MODELS).
// Depois disso a voz funciona sem internet.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

export const VOICE_MODELS_DIR =
  process.env.STELLA_VOICE_MODELS ?? fileURLToPath(new URL('../models/voz', import.meta.url));

/** Só baixa de endereços conhecidos, por HTTPS. */
const ALLOWED_HOSTS = new Set(['github.com', 'objects.githubusercontent.com']);

const mb = (bytes) => `${(bytes / 1e6).toFixed(0)} MB`;

async function download(entry, file) {
  const url = new URL(entry.url);
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname)) {
    throw new Error(`Endereço recusado para ${entry.name}: ${entry.url}`);
  }
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`Falha ao baixar ${entry.name}: HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || entry.size || 0;
  const hash = createHash('sha256');
  let done = 0;
  let last = 0;
  const body = Readable.fromWeb(res.body);
  body.on('data', (chunk) => {
    hash.update(chunk);
    done += chunk.length;
    if (Date.now() - last > 500) {
      last = Date.now();
      const pct = total ? ` ${Math.floor((done / total) * 100)}%` : '';
      process.stdout.write(`\r  ${entry.name}: ${mb(done)}${pct}`.padEnd(60));
    }
  });
  await pipeline(body, createWriteStream(`${file}.part`));
  process.stdout.write('\n');
  return hash.digest('hex');
}

/** Baixa e confere um modelo de voz; extrai os pacotes .tar.bz2. */
async function ensure(entry, dir, updateLock) {
  const marker = join(dir, `.${entry.name}.ok`);
  if (existsSync(marker) && (await readFile(marker, 'utf8')).trim() === entry.sha256) {
    console.log(`  ${entry.name}: já instalado`);
    return;
  }
  const file = join(dir, entry.file);
  console.log(`Baixando ${entry.name} (${mb(entry.size ?? 0)})...`);
  const sha = await download(entry, file);
  if (entry.sha256 && entry.sha256 !== sha && !updateLock) {
    await rm(`${file}.part`, { force: true });
    throw new Error(
      `${entry.name}: SHA-256 diferente do lock.\n    esperado ${entry.sha256}\n    baixado  ${sha}`,
    );
  }
  entry.sha256 = sha;
  await rename(`${file}.part`, file);
  if (entry.file.endsWith('.msi')) {
    // Extrai o instalador numa pasta (instalação administrativa): não instala nada no
    // Windows, não pede admin e não roda nada do pacote.
    const target = join(dir, entry.name);
    const msi = spawnSync('msiexec', ['/a', file, '/qn', `TARGETDIR=${target}`], {
      stdio: 'inherit',
    });
    if (msi.status !== 0) {
      throw new Error(`Não consegui extrair ${entry.file} (msiexec ${msi.status}).`);
    }
    await rm(file, { force: true });
  } else if (entry.file.endsWith('.tar.bz2')) {
    // tar do Windows (bsdtar) entende .tar.bz2; não roda nada do pacote.
    const tar = spawnSync('tar', ['-xjf', entry.file], { cwd: dir, stdio: 'inherit' });
    if (tar.status !== 0) throw new Error(`Não consegui extrair ${entry.file}.`);
    await rm(file, { force: true });
  }
  await writeFile(marker, `${sha}\n`);
  console.log(`  ${entry.name}: SHA-256 confere`);
}

/** Baixa os modelos de voz do lock. Devolve false se algum não conferiu. */
export async function pullVoiceModels(lock, { updateLock = false } = {}) {
  const entries = lock.voice ?? [];
  if (entries.length === 0) return true;
  await mkdir(VOICE_MODELS_DIR, { recursive: true });
  console.log(`Modelos de voz em ${VOICE_MODELS_DIR}`);
  let ok = true;
  for (const entry of entries) {
    try {
      await ensure(entry, VOICE_MODELS_DIR, updateLock);
    } catch (err) {
      console.error(`  ${err instanceof Error ? err.message : err}`);
      ok = false;
    }
  }
  return ok;
}

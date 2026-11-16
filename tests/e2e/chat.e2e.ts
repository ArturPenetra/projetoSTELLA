import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { startFakeOllama, type FakeOllama } from '@stella/core/testing';

const MAIN = join(import.meta.dirname, '../../apps/desktop/out/main/index.js');

async function launch(ollamaUrl: string): Promise<{ app: ElectronApplication; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'stella-e2e-'));
  await writeFile(
    join(dir, 'config.json'),
    JSON.stringify({ llm: { baseUrl: ollamaUrl, model: 'qwen3.5:2b' } }),
  );
  const app = await electron.launch({
    args: [MAIN],
    env: { ...process.env, STELLA_USER_DATA_DIR: dir },
  });
  return { app, dir };
}

let fake: FakeOllama | undefined;
let app: ElectronApplication | undefined;
let dir: string | undefined;

test.afterEach(async () => {
  await app?.close();
  await fake?.close();
  if (dir) await rm(dir, { recursive: true, force: true });
  app = fake = dir = undefined;
});

test('pergunta recebe resposta em streaming', async () => {
  fake = await startFakeOllama({ reply: ['Oi!', ' Eu sou', ' a Stella.'], delayMs: 80 });
  ({ app, dir } = await launch(fake.url));
  const page = await app.firstWindow();

  await expect(page.locator('#status-dot')).toHaveAttribute('data-state', 'ready');

  // Registra cada versão do texto da resposta, para provar que ela chegou aos poucos.
  await page.evaluate(() => {
    const seen: string[] = [];
    (globalThis as unknown as { seen: string[] }).seen = seen;
    new MutationObserver(() => {
      const last = document.querySelector('.msg.assistant:last-of-type');
      const text = last?.textContent ?? '';
      if (text && seen.at(-1) !== text) seen.push(text);
    }).observe(document.getElementById('messages') as HTMLElement, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  });

  await page.locator('#input').fill('Olá, quem é você?');
  await page.keyboard.press('Enter');
  await expect(page.locator('#send')).toHaveText('Parar');

  const reply = page.locator('.msg.assistant').last();
  await expect(reply).toHaveText('Oi! Eu sou a Stella.');
  await expect(page.locator('#send')).toHaveText('Enviar');
  await page.screenshot({ path: 'test-results/chat-streaming.png' });

  const seen = await page.evaluate(() => (globalThis as unknown as { seen: string[] }).seen);
  expect(seen).toEqual(['Oi!', 'Oi! Eu sou', 'Oi! Eu sou a Stella.']);
  expect(fake.requests).toHaveLength(1);
});

test('com o Ollama desligado, avisa sem travar', async () => {
  const tmp = await startFakeOllama();
  const deadUrl = tmp.url;
  await tmp.close();
  ({ app, dir } = await launch(deadUrl));
  const page = await app.firstWindow();

  await expect(page.locator('#banner')).toBeVisible();
  await expect(page.locator('#banner-text')).toContainText('Ollama');

  await page.locator('#input').fill('Tem alguém aí?');
  await page.keyboard.press('Enter');
  await expect(page.locator('.msg.error')).toContainText('Não consegui falar com o Ollama');
  await expect(page.locator('#send')).toHaveText('Enviar');
  await page.screenshot({ path: 'test-results/ollama-desligado.png' });

  // Continua respondendo: o botão Nova conversa limpa a tela.
  await page.locator('#reset').click();
  await expect(page.locator('.msg')).toHaveCount(0);
});

test('o renderer não tem acesso ao Node', async () => {
  fake = await startFakeOllama();
  ({ app, dir } = await launch(fake.url));
  const page = await app.firstWindow();
  const exposed = await page.evaluate(() => ({
    require: typeof (globalThis as { require?: unknown }).require,
    process: typeof (globalThis as { process?: unknown }).process,
    stella: Object.keys((globalThis as unknown as { stella: object }).stella).sort(),
  }));
  expect(exposed).toEqual({
    require: 'undefined',
    process: 'undefined',
    stella: ['appName', 'chat', 'llm', 'versions'],
  });
});

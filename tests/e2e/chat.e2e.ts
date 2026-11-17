import { expect, test } from '@playwright/test';
import { startFakeOllama, type FakeOllama } from '@stella/core/testing';
import { launch, openChatByAvatar, type Launched } from './helpers.js';

let fake: FakeOllama | undefined;
let stella: Launched | undefined;

test.afterEach(async () => {
  await stella?.close();
  await fake?.close();
  stella = fake = undefined;
});
test('pergunta recebe resposta em streaming', async () => {
  fake = await startFakeOllama({ reply: ['Oi!', ' Eu sou', ' a Stella.'], delayMs: 400 });
  stella = await launch(fake.url);
  const page = await openChatByAvatar(stella);

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
  stella = await launch(deadUrl);
  const page = await openChatByAvatar(stella);

  await expect(page.locator('#banner')).toBeVisible();
  await expect(page.locator('#banner-text')).toContainText('Ollama');

  await page.locator('#input').fill('Tem alguém aí?');
  await page.keyboard.press('Enter');
  await expect(page.locator('.msg.error')).toContainText('Não consegui falar com o Ollama');
  await expect(page.locator('#send')).toHaveText('Enviar');
  await page.screenshot({ path: 'test-results/ollama-desligado.png' });

  // Continua respondendo: o botão Nova limpa a tela.
  await page.locator('#reset').click();
  await expect(page.locator('.msg')).toHaveCount(0);
});

test('as janelas não têm acesso ao Node e cada uma só vê a própria API', async () => {
  fake = await startFakeOllama();
  stella = await launch(fake.url);
  const inspect = () => {
    const g = globalThis as unknown as Record<string, object | undefined>;
    return {
      require: typeof g['require'],
      process: typeof g['process'],
      stella: g['stella'] ? Object.keys(g['stella']).sort() : null,
      companion: g['companion'] ? Object.keys(g['companion']).sort() : null,
    };
  };
  expect(await stella.chat.evaluate(inspect)).toEqual({
    require: 'undefined',
    process: 'undefined',
    stella: ['appName', 'chat', 'llm', 'memory', 'personas', 'tools', 'versions'],
    companion: null,
  });
  expect(await stella.companion.evaluate(inspect)).toEqual({
    require: 'undefined',
    process: 'undefined',
    stella: null,
    companion: [
      'bubbleClick',
      'dragEnd',
      'dragMove',
      'dragStart',
      'openChat',
      'openMenu',
      'onPersona',
      'onState',
      'setInteractive',
    ].sort(),
  });
});

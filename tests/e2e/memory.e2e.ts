import { rm } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { startFakeOllama, type FakeChatRequest, type FakeOllama } from '@stella/core/testing';
import { launch, openChatByAvatar, type Launched } from './helpers.js';

let fake: FakeOllama | undefined;
let stella: Launched | undefined;
let dataDir: string | undefined;

test.afterEach(async () => {
  await stella?.close();
  await fake?.close();
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
  stella = fake = dataDir = undefined;
});

/** Extrator de mentira: "meu nome é X" vira fato, como o modelo real faria. */
function extractName(body: FakeChatRequest): string {
  const user = body.messages.at(-1)?.content ?? '';
  const name = /meu nome é (\p{L}+)/iu.exec(user);
  return JSON.stringify({
    facts: name ? [{ text: `O usuário se chama ${name[1]}.`, sensitive: false }] : [],
  });
}

async function send(chat: Page, text: string): Promise<void> {
  const replies = chat.locator('.msg.assistant:not(.pending)');
  const before = await replies.count();
  await chat.locator('#input').fill(text);
  await chat.keyboard.press('Enter');
  await expect(replies).toHaveCount(before + 1);
  await expect(chat.locator('#send')).toHaveText('Enviar');
}

/** Prompt de sistema do último pedido de conversa que chegou ao Ollama. */
function lastSystemPrompt(): string {
  return fake?.requests.at(-1)?.messages[0]?.content ?? '';
}

test('um fato dito numa sessão é lembrado na seguinte; apagado, é esquecido', async () => {
  fake = await startFakeOllama({ reply: ['Certo!'], complete: extractName });

  // Sessão 1: o usuário conta o nome; a Stella avisa que guardou.
  stella = await launch(fake.url);
  dataDir = stella.dir;
  let chat = await openChatByAvatar(stella);
  await send(chat, 'Oi! Meu nome é Artur.');
  await expect(chat.locator('.msg.note')).toHaveText(
    'Guardei na memória: O usuário se chama Artur.',
  );
  expect(lastSystemPrompt()).not.toContain('Artur');
  await chat.screenshot({ path: 'test-results/memoria-guardei.png' });
  await stella.close({ keepData: true });

  // Sessão 2 (app reaberto): o nome vai junto com a pergunta.
  stella = await launch(fake.url, {}, { dir: dataDir });
  chat = await openChatByAvatar(stella);
  await send(chat, 'Qual é o meu nome?');
  expect(lastSystemPrompt()).toContain('- O usuário se chama Artur.');

  // Na tela de memória, o usuário manda esquecer.
  await chat.locator('#memory-open').click();
  const fact = chat.locator('#memory-list .fact');
  await expect(fact).toHaveCount(1);
  await expect(fact.locator('.fact-text')).toHaveText('O usuário se chama Artur.');
  await chat.screenshot({ path: 'test-results/memoria-tela.png' });
  await fact.getByRole('button', { name: /Esquecer/ }).click();
  await expect(fact).toHaveCount(0);
  await expect(chat.locator('#memory-empty')).toBeVisible();
  await chat.locator('#memory-close').click();

  // A partir da próxima mensagem, o fato não vai mais para o modelo.
  await send(chat, 'E agora, lembra?');
  expect(lastSystemPrompt()).not.toContain('Artur');
  await stella.close({ keepData: true });

  // Sessão 3: continua esquecido.
  stella = await launch(fake.url, {}, { dir: dataDir });
  chat = await openChatByAvatar(stella);
  await send(chat, 'Qual é o meu nome?');
  expect(lastSystemPrompt()).not.toContain('Artur');
});

test('editar um fato e esquecer tudo pela tela de memória', async () => {
  fake = await startFakeOllama({ reply: ['Certo!'], complete: extractName });
  stella = await launch(fake.url);
  const chat = await openChatByAvatar(stella);
  await send(chat, 'Meu nome é Ana.');
  await expect(chat.locator('.msg.note')).toHaveCount(1);

  // Clicar no aviso abre a tela de memória.
  await chat.locator('.msg.note').click();
  const fact = chat.locator('#memory-list .fact');
  await fact.getByRole('button', { name: 'Editar' }).click();
  await fact.locator('textarea').fill('O usuário prefere ser chamado de Aninha.');
  await fact.getByRole('button', { name: 'Salvar' }).click();
  await expect(fact.locator('.fact-text')).toHaveText('O usuário prefere ser chamado de Aninha.');
  await chat.locator('#memory-close').click();

  await send(chat, 'Oi de novo');
  expect(lastSystemPrompt()).toContain('Aninha');
  expect(lastSystemPrompt()).not.toContain('se chama Ana');

  // Esquecer tudo pede confirmação com a ação escrita por extenso.
  await chat.locator('#memory-open').click();
  await chat.locator('#memory-clear-history').check();
  const clear = chat.locator('#memory-clear');
  await clear.click();
  await expect(clear).toHaveText('Confirmar: apagar fatos e conversas');
  await clear.click();
  await expect(chat.locator('#memory-status')).toHaveText('Esqueci tudo, inclusive as conversas.');
  await expect(fact).toHaveCount(0);
});

test('memória desligada: o chat funciona e a tela explica', async () => {
  fake = await startFakeOllama({ reply: ['Oi!'], complete: extractName });
  stella = await launch(fake.url);
  await stella.close({ keepData: true });
  dataDir = stella.dir;
  // Reabre com memory.enabled = false no config.json.
  stella = await launch(
    fake.url,
    { 'config.json': { llm: { baseUrl: fake.url }, memory: { enabled: false } } },
    { dir: dataDir },
  );
  const chat = await openChatByAvatar(stella);
  await send(chat, 'Meu nome é Ana.');
  await expect(chat.locator('.msg.assistant')).toHaveText('Oi!');
  expect(fake.completions).toHaveLength(0);
  await chat.locator('#memory-open').click();
  await expect(chat.locator('#memory-status')).toContainText('A memória está desligada');
});

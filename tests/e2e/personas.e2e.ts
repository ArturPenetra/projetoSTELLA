import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { startFakeOllama, type FakeChatRequest, type FakeOllama } from '@stella/core/testing';
import { isChatVisible, launch, openChatByAvatar, type Launched } from './helpers.js';

let fake: FakeOllama | undefined;
let stella: Launched | undefined;
let dataDir: string | undefined;

test.afterEach(async () => {
  await stella?.close();
  await fake?.close();
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
  stella = fake = dataDir = undefined;
});

async function readProfile(dir: string): Promise<unknown> {
  return JSON.parse(await readFile(join(dir, 'profile.json'), 'utf8'));
}

/** Primeira abertura: o chat aparece sozinho com as boas-vindas. */
async function startOnboarding(): Promise<Launched> {
  fake = await startFakeOllama({ reply: ['Certo!'] });
  const s = await launch(fake.url, {}, { onboarded: false });
  stella = s;
  await expect.poll(() => isChatVisible(s.app)).toBe(true);
  const chat = s.chat;
  await expect(chat.locator('#onboarding')).toBeVisible();
  await expect(chat.locator('#onboarding-title')).toHaveText('Boas-vindas!');
  // As 4 iniciais se apresentam em turnos.
  await expect(chat.locator('.welcome-item')).toHaveCount(4);
  await expect(chat.locator('.welcome-item strong')).toHaveText([
    'Leo · Energia e motivação',
    'Corni · Foco e organização',
    'Aqua · Ideias e aprendizado',
    'Pixi · Acolhimento e criatividade',
  ]);
  await chat.screenshot({ path: 'test-results/onboarding-boas-vindas.png' });
  await chat.getByRole('button', { name: 'Vamos lá' }).click();
  await expect(chat.locator('#onboarding-title')).toHaveText('Qual é o seu signo?');
  return s;
}

/** Última fala da companheira na conversa, com o nome de quem falou. */
async function lastReply(chat: Page) {
  const reply = chat.locator('.msg.assistant:not(.pending)').last();
  await expect(reply).toBeVisible();
  return { text: await reply.textContent(), speaker: await reply.getAttribute('data-speaker') };
}

test('onboarding pelo signo: sugere a Pixi, ela se apresenta e pergunta o nome', async () => {
  const s = await startOnboarding();
  const chat = s.chat;
  await chat.getByRole('button', { name: 'Peixes' }).click();
  await chat.locator('[data-preference="similar"]').click();
  await expect(chat.locator('#onboarding-title')).toHaveText('Sugestão: Pixi');
  await expect(chat.locator('#suggestion-reason')).toHaveText(
    'Pixi tem o mesmo jeito de ser que você.',
  );
  await chat.screenshot({ path: 'test-results/onboarding-sugestao.png' });
  await chat.getByRole('button', { name: 'Começar com ela' }).click();

  await expect(chat.locator('#onboarding')).toBeHidden();
  await expect(chat.locator('#persona-name')).toHaveText('Pixi');
  expect(await lastReply(chat)).toEqual({
    text: 'Oi... que bom que você veio. Como você está se sentindo hoje? Como posso te chamar?',
    speaker: 'Pixi',
  });
  // O avatar troca para a paleta da água e o nome no balão.
  const svg = s.companion.locator('#avatar svg');
  await expect(svg).toHaveAttribute('data-element', 'agua');
  await expect(s.companion.locator('#bubble-name')).toHaveText('Pixi');
  await chat.screenshot({ path: 'test-results/onboarding-pixi.png' });

  expect(await readProfile(s.dir)).toEqual({
    onboarded: true,
    personaId: 'pixi',
    sign: 'pisces',
    preference: 'similar',
  });
});

test('onboarding pela data: limite entre signos, persona futura e grade completa', async () => {
  const s = await startOnboarding();
  const chat = s.chat;
  await chat.getByRole('button', { name: /Não sei/ }).click();

  // Data que não existe.
  await chat.locator('#birth-day').fill('31');
  await chat.locator('#birth-month').selectOption('2');
  await chat.getByRole('button', { name: 'Continuar' }).click();
  await expect(chat.locator('.form-error')).toHaveText(
    'Essa data não existe. Confira o dia e o mês.',
  );

  // 20/03 fica no limite entre Peixes e Áries: o usuário escolhe.
  await chat.locator('#birth-day').fill('20');
  await chat.locator('#birth-month').selectOption('3');
  await chat.getByRole('button', { name: 'Continuar' }).click();
  await expect(chat.locator('#onboarding-title')).toHaveText(
    'Você nasceu bem no limite entre dois signos.',
  );
  await chat.getByRole('button', { name: 'Áries' }).click();

  // Áries + contraste = Canci, que ainda não existe: a Pixi assume.
  await chat.locator('[data-preference="contrast"]').click();
  await expect(chat.locator('#onboarding-title')).toHaveText('Sugestão: Pixi');
  await expect(chat.locator('#suggestion-reason')).toContainText(
    'A Canci chega em breve. Enquanto isso, a Pixi, do mesmo elemento, fica com você.',
  );

  // "Ver todas": 12 personas, só as 4 ativas podem ser escolhidas.
  await chat.getByRole('button', { name: 'Ver todas' }).click();
  await expect(chat.locator('.persona-card')).toHaveCount(12);
  await expect(chat.locator('.persona-card:disabled')).toHaveCount(8);
  await expect(chat.locator('.persona-card[data-id="corp"]')).toContainText('Em breve');
  await chat.screenshot({ path: 'test-results/onboarding-todas.png' });
  await chat.locator('.persona-card[data-id="corni"]').click();

  await expect(chat.locator('#persona-name')).toHaveText('Corni');
  expect((await lastReply(chat)).speaker).toBe('Corni');
  const profile = await readProfile(s.dir);
  expect(profile).toEqual({
    onboarded: true,
    personaId: 'corni',
    sign: 'aries',
    preference: 'contrast',
  });
  // A data de nascimento nunca é guardada.
  expect(JSON.stringify(profile)).not.toMatch(/20|mar/);
});

test('onboarding "prefiro não dizer": vai direto para a escolha, sem signo', async () => {
  const s = await startOnboarding();
  const chat = s.chat;
  await chat.getByRole('button', { name: 'Prefiro não dizer' }).click();
  await expect(chat.locator('#onboarding-title')).toHaveText('Escolha sua companhia');
  await chat.locator('.persona-card[data-id="leo"]').click();
  await expect(chat.locator('#persona-name')).toHaveText('Leo');
  expect((await lastReply(chat)).text).toBe(
    'E aí! Pronto pra fazer hoje valer a pena? Como posso te chamar?',
  );
  expect(await readProfile(s.dir)).toEqual({
    onboarded: true,
    personaId: 'leo',
    sign: null,
    preference: null,
  });
});

test('trocar de persona no meio da conversa: a nova retoma o assunto e vê a anterior', async () => {
  fake = await startFakeOllama({ reply: ['Bora organizar!'] });
  stella = await launch(fake.url);
  const chat = await openChatByAvatar(stella);
  await chat.locator('#input').fill('Quero organizar minha semana');
  await chat.keyboard.press('Enter');
  await expect(chat.locator('.msg.assistant[data-speaker="Aqua"]')).toHaveText('Bora organizar!');

  await chat.locator('#personas-open').click();
  await expect(chat.locator('.persona-card[aria-current="true"]')).toHaveAttribute(
    'data-id',
    'aqua',
  );
  await chat.screenshot({ path: 'test-results/personas-painel.png' });
  await chat.locator('.persona-card[data-id="corni"]').click();

  await expect(chat.locator('.msg.assistant[data-speaker="Corni"]')).toHaveCount(1);
  await expect(chat.locator('#persona-name')).toHaveText('Corni');
  await expect(stella.companion.locator('#avatar svg')).toHaveAttribute('data-element', 'terra');
  await chat.screenshot({ path: 'test-results/personas-troca.png' });

  const handoff = fake.requests.at(-1) as FakeChatRequest;
  const system = handoff.messages[0]?.content ?? '';
  expect(system).toContain('Você é Corni, uma das personas');
  // A conversa com a Aqua chega como transcrição, não como fala de assistente.
  expect(system).toContain('Usuário: Quero organizar minha semana\nAqua: Bora organizar!');
  expect(handoff.messages.slice(1)).toEqual([
    { role: 'user', content: expect.stringContaining('no lugar da Aqua') },
  ]);

  // A instrução de troca não aparece para o usuário.
  await expect(chat.locator('.msg.user')).toHaveCount(1);
  expect(await readProfile(stella.dir)).toMatchObject({ personaId: 'corni' });
});

test('um fato contado ao Leo é lembrado pela Pixi na sessão seguinte', async () => {
  fake = await startFakeOllama({
    reply: ['Certo!'],
    complete: (body) => {
      const name = /meu nome é (\p{L}+)/iu.exec(body.messages.at(-1)?.content ?? '');
      return JSON.stringify({
        facts: name ? [{ text: `O usuário se chama ${name[1]}.`, sensitive: false }] : [],
      });
    },
  });
  stella = await launch(fake.url, { 'profile.json': { onboarded: true, personaId: 'leo' } });
  dataDir = stella.dir;
  let chat = await openChatByAvatar(stella);
  await chat.locator('#input').fill('Meu nome é Artur.');
  await chat.keyboard.press('Enter');
  await expect(chat.locator('.msg.note')).toHaveText(
    'Guardei na memória: O usuário se chama Artur.',
  );
  await stella.close({ keepData: true });

  // Outra sessão, agora com a Pixi.
  stella = await launch(
    fake.url,
    { 'profile.json': { onboarded: true, personaId: 'pixi' } },
    { dir: dataDir },
  );
  chat = await openChatByAvatar(stella);
  await chat.locator('#input').fill('Qual é o meu nome?');
  await chat.keyboard.press('Enter');
  await expect(chat.locator('.msg.assistant[data-speaker="Pixi"]')).toHaveCount(1);
  const system = fake.requests.at(-1)?.messages[0]?.content ?? '';
  expect(system).toContain('Você é Pixi, uma das personas');
  expect(system).toContain('- O usuário se chama Artur. (');
  expect(system).toContain(', contou ao Leo)');
});

test('trocas rápidas seguidas: fica só o cumprimento da última persona', async () => {
  fake = await startFakeOllama({ reply: ['Vamos', ' nessa', ' juntos!'], delayMs: 120 });
  stella = await launch(fake.url);
  const chat = await openChatByAvatar(stella);
  await chat.locator('#input').fill('Quero correr 5 km em 2 meses');
  await chat.keyboard.press('Enter');
  await expect(chat.locator('.msg.assistant[data-speaker="Aqua"]')).toHaveText(
    'Vamos nessa juntos!',
  );

  // Três trocas sem esperar a anterior terminar.
  for (const id of ['corni', 'leo', 'pixi']) {
    await chat.locator('#personas-open').click();
    await chat.locator(`.persona-card[data-id="${id}"]`).click();
  }
  await expect(chat.locator('#persona-name')).toHaveText('Pixi');
  await expect(chat.locator('.msg.assistant[data-speaker="Pixi"]')).toHaveText(
    'Vamos nessa juntos!',
  );
  await expect(chat.locator('#send')).toHaveText('Enviar');

  // Na tela: a resposta da Aqua e um único cumprimento, o da Pixi.
  await expect(chat.locator('.msg.assistant')).toHaveCount(2);
  await expect(
    chat.locator('.msg.assistant[data-speaker="Corni"], .msg.assistant[data-speaker="Leo"]'),
  ).toHaveCount(0);
  await chat.screenshot({ path: 'test-results/personas-trocas-rapidas.png' });

  // No modelo: a Pixi vê a conversa real, sem fila de cumprimentos, e o assunto citado.
  const last = fake.requests.at(-1);
  const system = last?.messages[0]?.content ?? '';
  expect(system).toContain('Você é Pixi');
  // Só a conversa real (nenhum cumprimento da Corni ou do Leo).
  expect(system.slice(system.indexOf('Conversa até agora')).split('\n').slice(1)).toEqual([
    'Usuário: Quero correr 5 km em 2 meses',
    'Aqua: Vamos nessa juntos!',
  ]);
  expect(last?.messages).toHaveLength(2);
  expect(last?.messages[1]?.content).toContain('"Quero correr 5 km em 2 meses"');
});

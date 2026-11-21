import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type ElectronApplication } from '@playwright/test';
import { startFakeOllama, type FakeOllama } from '@stella/core/testing';
import { launch, openChatByAvatar, type Launched } from './helpers.js';

const MODELS = process.env['STELLA_VOICE_MODELS'] ?? join(import.meta.dirname, '../../models/voz');
const HAS_MODELS = existsSync(join(MODELS, '.kokoro-multi-lang-v1.0.ok'));

let fake: FakeOllama | undefined;
let stella: Launched | undefined;

test.afterEach(async () => {
  await stella?.close();
  await fake?.close();
  stella = fake = undefined;
});

/** Memória de todos os processos do app (MB), como o Gerenciador de Tarefas soma. */
async function appMemoryMb(app: ElectronApplication): Promise<number> {
  const kb = await app.evaluate(({ app: a }) =>
    a.getAppMetrics().reduce((sum, m) => sum + m.memory.workingSetSize, 0),
  );
  return Math.round(kb / 1024);
}

test('a voz começa desligada e, sem os modelos, explica o que fazer', async () => {
  const empty = await mkdtemp(join(tmpdir(), 'stella-sem-voz-'));
  fake = await startFakeOllama();
  stella = await launch(fake.url, {}, { env: { STELLA_VOICE_MODELS: empty } });
  const chat = await openChatByAvatar(stella);
  await expect(chat.locator('#voice-toggle')).toHaveAttribute('aria-pressed', 'false');
  await expect(chat.locator('#voice-bar')).toBeHidden();
  await chat.locator('#voice-toggle').click();
  await expect(chat.locator('#voice-bar')).toHaveAttribute('data-status', 'error');
  await expect(chat.locator('#voice-text')).toContainText('npm run models:pull');
  await expect(chat.locator('#voice-toggle')).toHaveAttribute('aria-pressed', 'false');
  // Nada ficou carregado: nenhuma janela de áudio aberta.
  expect(stella.app.windows().some((w) => w.url().endsWith('voice.html'))).toBe(false);
  await rm(empty, { recursive: true, force: true });
});

test.describe(() => {
  test.skip(!HAS_MODELS, 'modelos de voz não baixados (npm run models:pull)');

  test('ligar, ouvir a resposta falada, Esc e desligar liberando a memória', async () => {
    test.setTimeout(180_000);
    fake = await startFakeOllama({
      reply: ['Oi! Que bom falar com você. Hoje é um ótimo dia para começar algo novo, sabia?'],
    });
    stella = await launch(fake.url, {}, { env: { STELLA_VOICE_MODELS: MODELS } });
    const chat = await openChatByAvatar(stella);
    const before = await appMemoryMb(stella.app);

    await chat.locator('#voice-toggle').click();
    await expect(chat.locator('#voice-bar')).toHaveAttribute('data-status', 'loading');
    await expect(chat.locator('#voice-bar')).toHaveAttribute('data-status', 'listening', {
      timeout: 120_000,
    });
    await expect(chat.locator('#voice-toggle')).toHaveAttribute('aria-pressed', 'true');
    const on = await appMemoryMb(stella.app);

    // Resposta a uma mensagem digitada também é falada; no fim, volta a ouvir.
    await chat.locator('#input').fill('oi');
    await chat.keyboard.press('Enter');
    await expect(chat.locator('#voice-bar')).toHaveAttribute('data-status', 'speaking', {
      timeout: 30_000,
    });
    await expect(chat.locator('#voice-text')).toHaveText('Aqua está falando · Esc interrompe');
    await chat.screenshot({ path: 'test-results/voz-falando.png' });
    await chat.keyboard.press('Escape');
    await expect(chat.locator('#voice-bar')).toHaveAttribute('data-status', 'listening');

    await chat.locator('#voice-toggle').click();
    await expect(chat.locator('#voice-bar')).toBeHidden();
    await expect
      .poll(() => stella?.app.windows().some((w) => w.url().endsWith('voice.html')), {
        timeout: 10_000,
      })
      .toBe(false);
    // O processo de voz foi encerrado: a memória volta perto de onde estava.
    const { app } = stella;
    await expect.poll(() => appMemoryMb(app), { timeout: 15_000 }).toBeLessThan(before + 150);
    const off = await appMemoryMb(app);
    console.log(`Memória do app: antes ${before} MB, voz ligada ${on} MB, desligada ${off} MB`);
    expect(on - before).toBeGreaterThan(300);
  });
});

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { startFakeOllama, type FakeOllama } from '@stella/core/testing';
import { isChatVisible, launch, openChatByAvatar, type Launched } from './helpers.js';

let fake: FakeOllama | undefined;
let stella: Launched | undefined;

test.afterEach(async () => {
  await stella?.close();
  await fake?.close();
  stella = fake = undefined;
});

type Recorder = { moods: string[]; mouthOpen: number; happyEyes: boolean };

/** Grava cada estado do avatar (data-mood) e se a boca abriu e os olhos sorriram. */
async function recordAvatar(page: Page): Promise<void> {
  // Espera o cumprimento inicial (feliz) terminar.
  await expect(page.locator('#avatar')).toHaveAttribute('data-mood', 'parado', { timeout: 10_000 });
  await page.evaluate(() => {
    const rec: Recorder = { moods: [], mouthOpen: 0, happyEyes: false };
    (globalThis as unknown as { rec: Recorder }).rec = rec;
    const avatar = document.getElementById('avatar') as HTMLElement;
    const svg = avatar.querySelector('svg') as SVGElement;
    new MutationObserver(() => {
      const mood = avatar.dataset['mood'] ?? '';
      if (rec.moods.at(-1) !== mood) rec.moods.push(mood);
      if (svg.classList.contains('falando')) rec.mouthOpen++;
      if (svg.classList.contains('feliz')) rec.happyEyes = true;
    }).observe(avatar, {
      attributes: true,
      subtree: true,
      attributeFilter: ['data-mood', 'class'],
    });
  });
}

const recorded = (page: Page) =>
  page.evaluate(() => (globalThis as unknown as { rec: Recorder }).rec);

function companionWindow(app: ElectronApplication) {
  return app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().endsWith('companion.html'),
    );
    if (!win) throw new Error('janela da companheira não encontrada');
    const [x = 0, y = 0] = win.getPosition();
    return {
      x,
      y,
      visible: win.isVisible(),
      focusable: win.isFocusable(),
      focused: win.isFocused(),
      alwaysOnTop: win.isAlwaysOnTop(),
    };
  });
}

test('cumprimenta ao abrir e fica no topo, transparente e sem foco', async () => {
  fake = await startFakeOllama();
  stella = await launch(fake.url);
  const { companion, app } = stella;

  await expect(companion.locator('#bubble')).toBeVisible();
  await expect(companion.locator('#bubble-name')).toHaveText('Stella');
  await expect(companion.locator('#bubble-text')).toContainText('Clique em mim');

  await expect.poll(async () => (await companionWindow(app)).visible).toBe(true);
  const win = await companionWindow(app);
  expect(win).toMatchObject({
    focusable: false,
    focused: false,
    alwaysOnTop: true,
  });
  // O chat começa escondido: só o avatar aparece.
  expect(await isChatVisible(app)).toBe(false);
  await companion.screenshot({ path: 'test-results/companion-ola.png', omitBackground: true });
});

test('o avatar muda de estado conforme o chat', async () => {
  fake = await startFakeOllama({
    reply: ['Oi!', ' Que bom', ' te ver', ' por aqui.'],
    delayMs: 250,
    firstDelayMs: 1000,
  });
  stella = await launch(fake.url);
  const { companion } = stella;
  const chat = await openChatByAvatar(stella);
  await expect(chat.locator('#status-dot')).toHaveAttribute('data-state', 'ready');
  await recordAvatar(companion);

  await chat.locator('#input').fill('Oi, Stella!');
  await chat.keyboard.press('Enter');

  await expect(companion.locator('#avatar')).toHaveAttribute('data-mood', 'pensando');
  await expect(companion.locator('#bubble')).toHaveClass(/is-typing/);
  await companion.screenshot({ path: 'test-results/companion-pensando.png', omitBackground: true });

  await expect(companion.locator('#avatar')).toHaveAttribute('data-mood', 'falando');
  await companion.screenshot({ path: 'test-results/companion-falando.png', omitBackground: true });

  await expect(companion.locator('#avatar')).toHaveAttribute('data-mood', 'feliz');
  await expect(companion.locator('#bubble-text')).toHaveText('Oi! Que bom te ver por aqui.');
  await companion.screenshot({ path: 'test-results/companion-feliz.png', omitBackground: true });

  await expect(companion.locator('#avatar')).toHaveAttribute('data-mood', 'parado', {
    timeout: 10_000,
  });

  const rec = await recorded(companion);
  expect(rec.moods).toEqual(['pensando', 'falando', 'feliz', 'parado']);
  expect(rec.mouthOpen).toBeGreaterThan(0);
  expect(rec.happyEyes).toBe(true);
});

test('responder não tira o foco do app que o usuário está usando', async () => {
  fake = await startFakeOllama({ reply: ['Tudo', ' certo', ' por aqui!'], delayMs: 200 });
  stella = await launch(fake.url);
  const { app, chat, companion } = stella;
  await expect(chat.locator('#status-dot')).toHaveAttribute('data-state', 'ready');

  // Uma janela qualquer faz o papel do "outro app" em uso, com o chat da Stella fechado.
  const focusedBefore = await app.evaluate(({ BrowserWindow }) => {
    const g = globalThis as unknown as { companionFocus: number };
    g.companionFocus = 0;
    for (const w of BrowserWindow.getAllWindows()) {
      if (w.webContents.getURL().endsWith('companion.html')) {
        w.on('focus', () => g.companionFocus++);
      }
    }
    const other = new BrowserWindow({ width: 320, height: 200, title: 'Outro app' });
    other.focus();
    return BrowserWindow.getFocusedWindow()?.id ?? null;
  });

  await recordAvatar(companion);
  // A mensagem vai pelo processo principal, como se tivesse sido enviada antes.
  await chat.evaluate(() =>
    (
      globalThis as unknown as { stella: { chat: { send(t: string): Promise<unknown> } } }
    ).stella.chat.send('Oi'),
  );
  await expect(companion.locator('#avatar')).toHaveAttribute('data-mood', 'feliz');
  await expect(companion.locator('#bubble-text')).toHaveText('Tudo certo por aqui!');

  const after = await app.evaluate(({ BrowserWindow }) => ({
    focused: BrowserWindow.getFocusedWindow()?.id ?? null,
    companionFocus: (globalThis as unknown as { companionFocus: number }).companionFocus,
  }));
  expect(after).toEqual({ focused: focusedBefore, companionFocus: 0 });
  expect(await isChatVisible(app)).toBe(false);
  expect((await recorded(companion)).moods).toEqual(['pensando', 'falando', 'feliz']);
});

test('arrastar move a janela e a posição fica salva', async () => {
  fake = await startFakeOllama();
  stella = await launch(fake.url);
  const { app, companion, dir } = stella;
  await expect.poll(async () => (await companionWindow(app)).visible).toBe(true);
  const start = await companionWindow(app);

  // Com o mouse de verdade, screenX/screenY são absolutos. O mouse simulado do Playwright
  // recalcula a posição de tela a partir da janela (que está se movendo), então aqui os
  // eventos são criados com coordenadas de tela fixas, como o Windows mandaria.
  await companion.evaluate(async () => {
    const avatar = document.getElementById('avatar') as HTMLElement;
    const svg = avatar.querySelector('svg') as SVGElement;
    const r = svg.getBoundingClientRect();
    const target = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) as Element;
    const sx = 1000;
    const sy = 700;
    const fire = (type: string, dx: number, dy: number) =>
      target.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          pointerId: 7,
          button: 0,
          screenX: sx + dx,
          screenY: sy + dy,
        }),
      );
    fire('pointerdown', 0, 0);
    for (let i = 1; i <= 12; i++) {
      fire('pointermove', -10 * i, (-20 * i) / 3);
      await new Promise((r) => setTimeout(r, 16));
    }
    fire('pointerup', -120, -80);
  });

  await expect
    .poll(async () => {
      const now = await companionWindow(app);
      return { dx: now.x - start.x, dy: now.y - start.y };
    })
    .toEqual({ dx: -120, dy: -80 });
  // Arrastar não conta como clique: o chat continua fechado.
  expect(await isChatVisible(app)).toBe(false);

  await expect
    .poll(async () =>
      JSON.parse(await readFile(join(dir, 'companion.json'), 'utf8').catch(() => '{}')),
    )
    .toEqual({ x: start.x - 120, y: start.y - 80, visible: true });
});

test('posição salva fora da tela volta para dentro', async () => {
  fake = await startFakeOllama();
  stella = await launch(fake.url, { 'companion.json': { x: 50_000, y: 50_000, visible: true } });
  const { app } = stella;
  const area = await app.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea);
  await expect.poll(async () => (await companionWindow(app)).visible).toBe(true);
  const win = await companionWindow(app);
  expect(win.x).toBeLessThan(area.x + area.width);
  expect(win.y).toBeLessThan(area.y + area.height);
});

test('fechar o chat só esconde; a Stella continua aberta', async () => {
  fake = await startFakeOllama();
  stella = await launch(fake.url);
  const { app } = stella;
  await openChatByAvatar(stella);

  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().endsWith('index.html'))
      ?.close();
  });
  await expect.poll(() => isChatVisible(app)).toBe(false);
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(2);
  expect((await companionWindow(app)).visible).toBe(true);

  // Clicar no avatar de novo reabre o mesmo chat.
  await openChatByAvatar(stella);
});

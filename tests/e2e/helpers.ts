import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  _electron as electron,
  expect,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

const MAIN = join(import.meta.dirname, '../../apps/desktop/out/main/index.js');

export interface Launched {
  app: ElectronApplication;
  dir: string;
  companion: Page;
  chat: Page;
  close(): Promise<void>;
}

/** Espera a janela cujo endereço termina com `page` (index.html ou companion.html). */
async function windowFor(app: ElectronApplication, page: string): Promise<Page> {
  await expect
    .poll(() => app.windows().some((w) => w.url().endsWith(page)), { timeout: 15_000 })
    .toBe(true);
  const win = app.windows().find((w) => w.url().endsWith(page)) as Page;
  await win.waitForLoadState('domcontentloaded');
  return win;
}

/** Abre a Stella com uma pasta de dados temporária apontando para o Ollama informado. */
export async function launch(
  ollamaUrl: string,
  files: Record<string, unknown> = {},
): Promise<Launched> {
  const dir = await mkdtemp(join(tmpdir(), 'stella-e2e-'));
  await writeFile(
    join(dir, 'config.json'),
    JSON.stringify({ llm: { baseUrl: ollamaUrl, model: 'qwen3.5:2b' } }),
  );
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(dir, name), JSON.stringify(content));
  }
  const app = await electron.launch({
    args: [MAIN],
    env: { ...process.env, STELLA_USER_DATA_DIR: dir },
  });
  const [companion, chat] = await Promise.all([
    windowFor(app, 'companion.html'),
    windowFor(app, 'index.html'),
  ]);
  return {
    app,
    dir,
    companion,
    chat,
    close: async () => {
      await app.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

/** Clica no avatar (como o usuário faz) e espera a janela de chat aparecer. */
export async function openChatByAvatar(l: Launched): Promise<Page> {
  await l.companion.locator('#avatar svg').click();
  await expect.poll(() => isChatVisible(l.app)).toBe(true);
  return l.chat;
}

export function isChatVisible(app: ElectronApplication): Promise<boolean> {
  return app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().some(
      (w) => w.webContents.getURL().endsWith('index.html') && w.isVisible(),
    ),
  );
}

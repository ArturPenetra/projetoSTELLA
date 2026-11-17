import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { clampToScreens, CompanionStateStore, defaultPosition } from './window-position.js';

const size = { width: 300, height: 420 };
const main = { x: 0, y: 0, width: 1920, height: 1040 };
const right = { x: 1920, y: 0, width: 1280, height: 984 };

describe('defaultPosition', () => {
  it('fica no canto inferior direito, colada na barra de tarefas', () => {
    expect(defaultPosition(main, size)).toEqual({ x: 1920 - 300 - 24, y: 1040 - 420 });
  });
});

describe('clampToScreens', () => {
  it('não mexe numa posição visível', () => {
    expect(clampToScreens({ x: 500, y: 300 }, size, [main, right])).toEqual({ x: 500, y: 300 });
    expect(clampToScreens({ x: 2200, y: 100 }, size, [main, right])).toEqual({ x: 2200, y: 100 });
  });

  it('traz de volta uma janela que ficou fora de todas as telas', () => {
    expect(clampToScreens({ x: 9000, y: 5000 }, size, [main])).toEqual({
      x: 1920 - 80,
      y: 1040 - 80,
    });
    expect(clampToScreens({ x: -2000, y: -500 }, size, [main])).toEqual({ x: -300 + 80, y: 0 });
  });

  it('usa a tela onde a janela está mais visível', () => {
    expect(clampToScreens({ x: 3300, y: 200 }, size, [main, right])).toEqual({
      x: 1920 + 1280 - 80,
      y: 200,
    });
  });

  it('sem telas, devolve a posição como veio', () => {
    expect(clampToScreens({ x: 1, y: 2 }, size, [])).toEqual({ x: 1, y: 2 });
  });
});

describe('CompanionStateStore', () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('salva e lê a posição', async () => {
    dir = await mkdtemp(join(tmpdir(), 'stella-pos-'));
    const store = new CompanionStateStore(dir);
    expect(await store.load()).toEqual({ visible: true });
    await store.save({ x: 10, y: 20, visible: false });
    expect(await store.load()).toEqual({ x: 10, y: 20, visible: false });
  });

  it('ignora arquivo inválido', async () => {
    dir = await mkdtemp(join(tmpdir(), 'stella-pos-'));
    const store = new CompanionStateStore(dir);
    await writeFile(store.path, '{"x": "longe"}');
    expect(await store.load()).toEqual({ visible: true });
    await writeFile(store.path, 'não é json');
    expect(await store.load()).toEqual({ visible: true });
  });
});

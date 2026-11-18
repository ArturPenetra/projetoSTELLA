import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listStartMenuApps, startMenuDirs } from './start-menu.js';

describe('listStartMenuApps', () => {
  let user: string;
  let all: string;
  beforeEach(async () => {
    user = await mkdtemp(join(tmpdir(), 'stella-menu-usuario-'));
    all = await mkdtemp(join(tmpdir(), 'stella-menu-todos-'));
    await mkdir(join(user, 'Discord Inc'));
    await writeFile(join(user, 'Discord Inc', 'Discord.lnk'), '');
    await writeFile(join(user, 'Desinstalar Algo.lnk'), '');
    await writeFile(join(user, 'leia-me.txt'), '');
    await mkdir(join(all, 'Accessories'));
    await writeFile(join(all, 'Accessories', 'Notepad.lnk'), '');
    await writeFile(join(all, 'Discord.lnk'), '');
  });
  afterEach(async () => {
    await rm(user, { recursive: true, force: true });
    await rm(all, { recursive: true, force: true });
  });

  it('lista os atalhos de apps das duas pastas, sem desinstaladores nem repetidos', async () => {
    const apps = await listStartMenuApps([user, all]);
    expect(apps).toEqual([
      { name: 'Discord', path: join(user, 'Discord Inc', 'Discord.lnk') },
      { name: 'Notepad', path: join(all, 'Accessories', 'Notepad.lnk') },
    ]);
  });

  it('pasta que não existe é ignorada', async () => {
    expect(await listStartMenuApps([join(user, 'nao-existe')])).toEqual([]);
  });

  it('usa as pastas do Menu Iniciar do usuário e de todos', () => {
    expect(startMenuDirs({ APPDATA: 'C:\\A', ProgramData: 'C:\\P' })).toEqual([
      join('C:\\A', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
      join('C:\\P', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    ]);
  });
});

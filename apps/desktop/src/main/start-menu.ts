import { readdir } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';

export interface StartMenuEntry {
  name: string;
  path: string;
}

/** Atalhos que não são apps (desinstalar, ajuda, sites). */
const NOT_AN_APP =
  /desinstal|uninstall|leia-me|readme|ajuda|help|manual|website|\bsite\b|release notes|notas de vers/i;

/** As duas pastas do Menu Iniciar: a do usuário e a de todos os usuários. */
export function startMenuDirs(env: NodeJS.ProcessEnv = process.env): string[] {
  const dirs: string[] = [];
  if (env['APPDATA'])
    dirs.push(join(env['APPDATA'], 'Microsoft', 'Windows', 'Start Menu', 'Programs'));
  if (env['ProgramData']) {
    dirs.push(join(env['ProgramData'], 'Microsoft', 'Windows', 'Start Menu', 'Programs'));
  }
  return dirs;
}

async function collect(dir: string, depth: number, out: StartMenuEntry[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory() && depth > 0) await collect(full, depth - 1, out);
    else if (e.isFile() && extname(e.name).toLowerCase() === '.lnk') {
      const name = basename(e.name, extname(e.name)).trim();
      if (name && !NOT_AN_APP.test(name)) out.push({ name, path: full });
    }
  }
}

/**
 * Atalhos de apps do Menu Iniciar, sem repetir nomes (o do usuário vence), em ordem
 * alfabética. Abrir pelo atalho é o mesmo que clicar no Menu Iniciar: funciona com apps
 * que usam um iniciador (como o Discord) e com apps da Microsoft Store.
 */
export async function listStartMenuApps(dirs = startMenuDirs()): Promise<StartMenuEntry[]> {
  const found: StartMenuEntry[] = [];
  for (const dir of dirs) await collect(dir, 3, found);
  const byName = new Map<string, StartMenuEntry>();
  for (const entry of found) {
    const key = entry.name.toLowerCase();
    if (!byName.has(key)) byName.set(key, entry);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

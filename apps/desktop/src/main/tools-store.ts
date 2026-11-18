import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  toolSettingsSchema,
  type AppEntry,
  type ToolLogEntry,
  type ToolSettings,
} from '@stella/core';

/** Apps do Windows sugeridos na lista (a ferramenta continua desligada até o usuário ligar). */
export function suggestedApps(systemRoot = process.env['SystemRoot'] ?? 'C:\\Windows'): AppEntry[] {
  const sys = join(systemRoot, 'System32');
  return [
    { name: 'Calculadora', path: join(sys, 'calc.exe'), aliases: [] },
    { name: 'Bloco de Notas', path: join(sys, 'notepad.exe'), aliases: [] },
    { name: 'Paint', path: join(sys, 'mspaint.exe'), aliases: [] },
  ].filter((a) => existsSync(a.path));
}

/** tools.json: o que está ligado, as pastas e os apps permitidos. */
export class ToolSettingsStore {
  readonly path: string;
  private current: ToolSettings = toolSettingsSchema.parse({});

  constructor(userDataDir: string) {
    this.path = join(userDataDir, 'tools.json');
  }

  get settings(): ToolSettings {
    return this.current;
  }

  /** Lê o arquivo. Sem arquivo: tudo desligado, sem pastas e com os apps sugeridos. */
  async load(): Promise<ToolSettings> {
    try {
      const parsed = toolSettingsSchema.safeParse(JSON.parse(await readFile(this.path, 'utf8')));
      this.current = parsed.success ? parsed.data : toolSettingsSchema.parse({});
      if (!parsed.success) console.warn('[ferramentas] tools.json inválido; usando os padrões');
    } catch {
      this.current = toolSettingsSchema.parse({ apps: suggestedApps() });
      await this.save(this.current);
    }
    return this.current;
  }

  async save(settings: ToolSettings): Promise<void> {
    this.current = toolSettingsSchema.parse(settings);
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify(this.current, null, 2) + '\n', 'utf8');
  }
}

/** Log de ações (uma linha JSON por pedido), para o usuário conferir o que foi feito. */
export class ToolLog {
  readonly path: string;

  constructor(userDataDir: string) {
    this.path = join(userDataDir, 'acoes.jsonl');
  }

  /** Gravações em fila: duas ações seguidas nunca saem fora de ordem no arquivo. */
  private queue: Promise<void> = Promise.resolve();

  append(entry: ToolLogEntry): void {
    this.queue = this.queue
      .then(() => mkdir(dirname(this.path), { recursive: true }))
      .then(() => appendFile(this.path, JSON.stringify(entry) + '\n', 'utf8'))
      .catch((err: unknown) => console.warn('[ferramentas] não consegui gravar o log', err));
  }

  /** Espera as gravações pendentes (testes e fechamento do app). */
  flushed(): Promise<void> {
    return this.queue;
  }

  /** As últimas entradas, da mais nova para a mais antiga. */
  async recent(limit = 50): Promise<ToolLogEntry[]> {
    let text: string;
    try {
      text = await readFile(this.path, 'utf8');
    } catch {
      return [];
    }
    const entries: ToolLogEntry[] = [];
    for (const line of text.split('\n').filter(Boolean).reverse()) {
      try {
        entries.push(JSON.parse(line) as ToolLogEntry);
      } catch {
        // linha corrompida: ignora
      }
      if (entries.length >= limit) break;
    }
    return entries;
  }
}

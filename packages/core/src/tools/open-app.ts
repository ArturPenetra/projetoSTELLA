import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { z } from 'zod';
import { ToolFailure, ToolRefusal, type AppEntry, type Tool, type ToolSettings } from './types.js';

const argsSchema = z.object({
  app: z.string().trim().min(1).max(60).describe('Nome do aplicativo, como está na lista'),
});
type Args = z.infer<typeof argsSchema>;

/** Programas (.exe) e atalhos (.lnk, como os do Menu Iniciar). */
export const APP_EXTENSIONS = ['.exe', '.lnk'] as const;

export interface LaunchResult {
  /** Se uma janela do app apareceu (ou veio para a frente) depois de abrir. */
  opened: boolean;
  /** Título da janela que apareceu, ou o motivo de não ter aberto. */
  detail?: string;
  /** O app já estava aberto: a janela dele foi trazida para a frente. */
  alreadyOpen?: boolean;
}

/**
 * Abre um programa ou atalho da lista, sem argumentos vindos do modelo e sem shell.
 * O app de desktop usa o jeito do Windows de abrir (como um duplo clique) e confere se
 * uma janela apareceu; aqui fica uma versão simples, para testes e uso fora do Electron.
 */
export type Launcher = ((path: string) => Promise<LaunchResult>) & {
  /** Opcional: começa a se preparar enquanto o usuário lê a confirmação. */
  prepare?: (path: string) => void;
};

export const defaultLauncher: Launcher = (path) =>
  new Promise((resolvePromise, reject) => {
    const child = spawn(path, [], { detached: true, stdio: 'ignore', shell: false });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolvePromise({ opened: true });
    });
  });

/** "Bloco de Notas", "bloco de notas" e "bloco-de-notas" são o mesmo app. */
export function normalizeAppName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function findApp(settings: ToolSettings, requested: string): AppEntry | undefined {
  const wanted = normalizeAppName(requested);
  return settings.apps.find((a) => normalizeAppName(a.name) === wanted);
}

export interface OpenAppOptions {
  launch?: Launcher;
  /**
   * Para atalhos: para onde apontam ("C:\...\Update.exe --processStart Discord.exe").
   * Aparece na confirmação, para o usuário ver exatamente o que vai rodar.
   */
  describeShortcut?: (path: string) => string | undefined;
}

/**
 * Abre só apps da lista que o usuário montou. O modelo diz o nome; o caminho vem da
 * lista. Sempre pede confirmação (é uma ação). Só diz "abri" se o app abriu de verdade.
 */
export function createOpenAppTool(options: OpenAppOptions | Launcher = {}): Tool<Args> {
  const { launch = defaultLauncher, describeShortcut } =
    typeof options === 'function' ? { launch: options } : options;

  const target = (app: AppEntry) => {
    if (extname(app.path).toLowerCase() !== '.lnk') return app.path;
    const points = describeShortcut?.(app.path);
    return points ? `${app.path}, atalho para ${points}` : app.path;
  };

  return {
    name: 'open_app',
    risk: 'action',
    schema: argsSchema,
    describe: (settings) =>
      `Abre um aplicativo do computador do usuário. Só estes podem ser abertos: ${settings.apps.map((a) => a.name).join(', ') || 'nenhum ainda'}.`,
    explain: (args, settings) => {
      const app = findApp(settings, args.app);
      return app
        ? `Abrir o aplicativo ${app.name} (${target(app)})`
        : `Abrir o aplicativo "${args.app}"`;
    },
    async check(args, settings) {
      const app = findApp(settings, args.app);
      if (!app) {
        const names = settings.apps.map((a) => a.name).join(', ') || 'nenhum';
        throw new ToolRefusal(
          `"${args.app}" não está na lista de apps permitidos (${names}); você pode adicioná-lo no botão Ferramentas`,
        );
      }
      const ext = extname(app.path).toLowerCase();
      if (!(APP_EXTENSIONS as readonly string[]).includes(ext)) {
        throw new ToolRefusal(
          `${app.name} não aponta para um programa (.exe) nem para um atalho (.lnk)`,
        );
      }
      const info = await stat(app.path).catch(() => undefined);
      if (!info?.isFile()) {
        throw new ToolRefusal(`não achei ${app.name} em ${app.path}`);
      }
      // Tudo certo: a confirmação vem a seguir; o lançador já pode ir se preparando.
      launch.prepare?.(app.path);
    },
    async run(args, ctx) {
      const app = findApp(ctx.settings, args.app) as AppEntry;
      const result = await launch(app.path);
      if (!result.opened) {
        throw new ToolFailure(
          `pedi ao Windows para abrir ${app.name}, mas nenhuma janela apareceu${result.detail ? ` (${result.detail})` : ''}. O app pode não estar instalado, ou estar aberto escondido na bandeja. Se ele tiver um atalho no Menu Iniciar, tente adicionar o atalho em Ferramentas`,
        );
      }
      if (result.alreadyOpen) {
        return {
          content: `Resultado: feito. ${app.name} já estava aberto; trouxe a janela para a frente.`,
          summary: `${app.name} já estava aberto; trouxe para a frente`,
        };
      }
      return { content: `Resultado: feito. Abri ${app.name}.`, summary: `Abri ${app.name}` };
    },
  };
}

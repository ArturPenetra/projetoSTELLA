import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { z } from 'zod';
import { ToolRefusal, type AppEntry, type Tool, type ToolSettings } from './types.js';

const argsSchema = z.object({
  app: z.string().trim().min(1).max(60).describe('Nome do aplicativo, como está na lista'),
});
type Args = z.infer<typeof argsSchema>;

/** Abre um executável sem argumentos e sem shell (nada do modelo vira comando). */
export type Launcher = (path: string) => Promise<void>;

export const defaultLauncher: Launcher = (path) =>
  new Promise((resolvePromise, reject) => {
    const child = spawn(path, [], { detached: true, stdio: 'ignore', shell: false });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolvePromise();
    });
  });

/** "Bloco de Notas", "bloco de notas" e "bloco-de-notas" são o mesmo app. */
export function normalizeAppName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function findApp(settings: ToolSettings, requested: string): AppEntry | undefined {
  const wanted = normalizeAppName(requested);
  return settings.apps.find((a) => normalizeAppName(a.name) === wanted);
}

/**
 * Abre só apps da lista que o usuário montou. O modelo diz o nome; o caminho vem da
 * lista. Sempre pede confirmação (é uma ação).
 */
export function createOpenAppTool(launch: Launcher = defaultLauncher): Tool<Args> {
  return {
    name: 'open_app',
    risk: 'action',
    schema: argsSchema,
    describe: (settings) =>
      `Abre um aplicativo do computador do usuário. Só estes podem ser abertos: ${settings.apps.map((a) => a.name).join(', ') || 'nenhum ainda'}. Se o usuário pedir outro, não chame a ferramenta: diga que ele pode adicionar o app em Ferramentas. Use só quando o usuário pedir para abrir um app.`,
    explain: (args, settings) => {
      const app = findApp(settings, args.app);
      return app
        ? `Abrir o aplicativo ${app.name} (${app.path})`
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
      if (extname(app.path).toLowerCase() !== '.exe') {
        throw new ToolRefusal(`${app.name} não aponta para um programa (.exe).`);
      }
      const info = await stat(app.path).catch(() => undefined);
      if (!info?.isFile())
        throw new ToolRefusal(`não achei o programa de ${app.name} em ${app.path}.`);
    },
    async run(args, ctx) {
      const app = findApp(ctx.settings, args.app) as AppEntry;
      await launch(app.path);
      return { content: `Resultado: feito. Abri ${app.name}.`, summary: `Abri ${app.name}` };
    },
  };
}

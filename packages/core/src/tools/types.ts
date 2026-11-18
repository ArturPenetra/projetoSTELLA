import { z } from 'zod';
import type { ToolSpec } from '../llm/types.js';

/**
 * Configurações das ferramentas (tools.json na pasta de dados). Tudo começa desligado e
 * sem pastas: o usuário liga cada ferramenta e escolhe as pastas e apps na tela.
 */
export const appEntrySchema = z.object({
  /** Nome que o usuário (e o modelo) usa: "Calculadora". */
  name: z.string().trim().min(1).max(60),
  /** Caminho completo do executável ou do atalho. */
  path: z.string().trim().min(1),
  /** Outros nomes que o usuário dá ao app ("opera" para "Navegador Opera GX"). */
  aliases: z.array(z.string().trim().min(1).max(60)).max(10).default([]),
});
export type AppEntry = z.infer<typeof appEntrySchema>;

export const toolSettingsSchema = z.object({
  enabled: z
    .object({
      open_app: z.boolean().default(false),
      read_file: z.boolean().default(false),
    })
    .prefault({}),
  /** Pastas que read_file pode ler (escolhidas pelo usuário no diálogo do sistema). */
  folders: z.array(z.string().trim().min(1)).default([]),
  /** Apps que open_app pode abrir. */
  apps: z.array(appEntrySchema).default([]),
});
export type ToolSettings = z.infer<typeof toolSettingsSchema>;
export type ToolName = keyof ToolSettings['enabled'];

/** "read": só lê; "action": muda algo no computador e sempre pede confirmação. */
export type ToolRisk = 'read' | 'action';

export interface ToolContext {
  settings: ToolSettings;
  signal?: AbortSignal | undefined;
}

export interface ToolResult {
  /** O que vai para o modelo. */
  content: string;
  /** Resumo curto para o usuário e para o log ("Li notas.txt (120 palavras)"). */
  summary: string;
  /** Conteúdo vindo de fora (arquivo, página): dado não confiável. */
  untrusted?: boolean;
}

/** Recusa explicada: vai para o modelo (que avisa o usuário) e para o log. */
export class ToolRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolRefusal';
  }
}

/** A ação foi tentada mas não deu certo; a mensagem explica ao usuário (log: "erro"). */
export class ToolFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolFailure';
  }
}

export interface Tool<Args = unknown> {
  name: ToolName;
  risk: ToolRisk;
  schema: z.ZodType<Args>;
  /** Descrição para o modelo (pode citar as pastas e apps permitidos). */
  describe(settings: ToolSettings): string;
  /** A ação escrita por extenso, para o diálogo de confirmação e o log. */
  explain(args: Args, settings: ToolSettings): string;
  /** Confere o escopo (pasta, lista de apps) antes de qualquer coisa. Lança ToolRefusal. */
  check(args: Args, settings: ToolSettings): Promise<void> | void;
  run(args: Args, ctx: ToolContext): Promise<ToolResult>;
}

/** Esquema JSON dos argumentos, no formato que o Ollama espera. */
export function toolSpec(tool: Tool, settings: ToolSettings): ToolSpec {
  const parameters = z.toJSONSchema(tool.schema) as Record<string, unknown>;
  delete parameters['$schema'];
  return { name: tool.name, description: tool.describe(settings), parameters };
}

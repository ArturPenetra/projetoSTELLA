import type { ToolCall } from '../llm/types.js';
import type { IntentRouter } from './router.js';
import {
  ToolRefusal,
  type Tool,
  type ToolName,
  type ToolResult,
  type ToolSettings,
} from './types.js';

export type ToolDecision = 'executado' | 'recusado pelo usuário' | 'bloqueado' | 'erro';

/**
 * Resultado de algo que não foi feito, já com o que a persona deve contar, em segunda pessoa.
 * Medido com o qwen3.5:2b: com textos sobre "o usuário" ele se perdia ("o computador dela tem
 * um bloqueio"); dizendo o que contar, ele explica certo.
 */
export function notDone(reason: string): string {
  const clean = reason.trim().replace(/[.;]+$/, '');
  return `Resultado: não feito. Diga ao usuário, com suas palavras: ${clean}.`;
}

export interface ConfirmRequest {
  tool: ToolName;
  /** A ação por extenso: "Abrir o aplicativo Calculadora (C:\...\calc.exe)". */
  action: string;
  /**
   * O pedido veio depois de ler conteúdo de fora (um arquivo) nesta resposta: pode ser
   * injeção de prompt. O diálogo mostra um aviso.
   */
  afterUntrusted: boolean;
}

export interface ToolLogEntry {
  at: number;
  tool: string;
  action: string;
  decision: ToolDecision;
  detail: string;
}

export interface ToolRunnerOptions {
  /** Configurações atuais (lidas a cada chamada: mudar na tela vale na hora). */
  settings: () => ToolSettings;
  /** Pergunta ao usuário. Sem resposta (fechou, Esc, tempo esgotado) conta como "não". */
  confirm: (request: ConfirmRequest, signal?: AbortSignal) => Promise<boolean>;
  log?: (entry: ToolLogEntry) => void;
  now?: () => number;
  /** Decide, pela mensagem do usuário, se ele pediu uma ferramenta. Sem roteador, nunca. */
  router?: IntentRouter;
}

/** O que a sessão de chat precisa para usar ferramentas. */
export interface ToolHost {
  /** Começa uma resposta nova (zera o "já leu conteúdo de fora"). */
  beginTurn(): void;
  /** Os pedidos de ferramenta que a mensagem do usuário contém (só ferramentas ligadas). */
  plan(userText: string, signal?: AbortSignal): Promise<ToolCall[]>;
  /** Executa (ou recusa) um pedido do modelo. Nunca lança: a explicação vai no resultado. */
  call(call: ToolCall, signal?: AbortSignal): Promise<ToolOutcome>;
}

export interface ToolOutcome {
  name: string;
  /** Texto para a mensagem `tool` que volta ao modelo. */
  content: string;
  /** Resumo para mostrar na conversa. */
  summary: string;
  decision: ToolDecision;
  /** Quando não foi feito: o motivo, em segunda pessoa, para contar ao usuário. */
  reason?: string;
}

/**
 * Resposta pronta quando nada do que foi pedido aconteceu. Medido com o qwen3.5:2b: deixando
 * o modelo contar a recusa, ele dizia "o app não conseguiu por um erro de sistema" mesmo
 * quando o usuário tinha recusado. Aqui a resposta é exata.
 */
export function refusalReply(outcomes: ToolOutcome[]): string | undefined {
  if (outcomes.length === 0 || outcomes.some((o) => o.decision === 'executado')) return undefined;
  return outcomes
    .map((o) => {
      const verb = o.name === 'read_file' ? 'Não li nada' : 'Não abri nada';
      return `${verb}: ${(o.reason ?? o.summary).replace(/[.;]+$/, '')}.`;
    })
    .join(' ');
}

/**
 * Aplica as regras de permissão a cada pedido do modelo, nesta ordem:
 * ferramenta existe → está ligada → argumentos válidos → dentro do escopo (pastas, apps)
 * → confirmação do usuário (ações) → executa. Tudo vai para o log.
 * Conteúdo lido de fora nunca libera nada: só deixa o próximo pedido com um aviso.
 */
export class ToolRunner implements ToolHost {
  private readonly tools = new Map<string, Tool<unknown>>();
  private readUntrusted = false;

  constructor(
    tools: Tool<unknown>[],
    private readonly options: ToolRunnerOptions,
  ) {
    for (const t of tools) this.tools.set(t.name, t);
  }

  async plan(userText: string, signal?: AbortSignal): Promise<ToolCall[]> {
    if (!this.options.router) return [];
    try {
      return await this.options.router.route(userText, signal);
    } catch (err) {
      if (signal?.aborted) throw err;
      // Roteador fora do ar: a conversa segue, só sem ferramentas nesta mensagem.
      return [];
    }
  }

  beginTurn(): void {
    this.readUntrusted = false;
  }

  async call(call: ToolCall, signal?: AbortSignal): Promise<ToolOutcome> {
    const settings = this.options.settings();
    const tool = this.tools.get(call.name);
    const finish = (
      decision: ToolDecision,
      action: string,
      content: string,
      summary: string,
      reason?: string,
    ): ToolOutcome => {
      this.options.log?.({
        at: (this.options.now ?? Date.now)(),
        tool: call.name,
        action,
        decision,
        detail: summary,
      });
      return { name: call.name, content, summary, decision, ...(reason ? { reason } : {}) };
    };
    /** Não foi feito: o modelo recebe o que contar, e a sessão pode responder sozinha. */
    const refuse = (decision: ToolDecision, action: string, reason: string, summary: string) =>
      finish(decision, action, notDone(reason), summary, reason);

    if (!tool) {
      return refuse('bloqueado', call.name, 'não conheço essa ação', 'Ferramenta desconhecida');
    }
    if (!settings.enabled[tool.name]) {
      return refuse(
        'bloqueado',
        call.name,
        'a ferramenta está desligada; você pode ligá-la no botão Ferramentas',
        'Ferramenta desligada',
      );
    }

    const parsed = tool.schema.safeParse(call.arguments);
    if (!parsed.success) {
      return refuse('bloqueado', call.name, 'não entendi o pedido', 'Pedido inválido');
    }
    const args = parsed.data;
    const action = tool.explain(args, settings);

    try {
      await tool.check(args, settings);
    } catch (err) {
      if (err instanceof ToolRefusal) return refuse('bloqueado', action, err.message, err.message);
      return refuse('erro', action, 'não consegui conferir esse pedido', 'Erro ao conferir');
    }

    if (tool.risk === 'action') {
      const allowed = await this.options
        .confirm({ tool: tool.name, action, afterUntrusted: this.readUntrusted }, signal)
        .catch(() => false);
      if (!allowed || signal?.aborted) {
        return refuse(
          'recusado pelo usuário',
          action,
          'você escolheu não permitir',
          'Você não permitiu',
        );
      }
    }

    let result: ToolResult;
    try {
      result = await tool.run(args, { settings, signal });
    } catch (err) {
      const message = err instanceof ToolRefusal ? err.message : 'algo deu errado ao executar';
      return refuse(err instanceof ToolRefusal ? 'bloqueado' : 'erro', action, message, message);
    }
    if (result.untrusted) this.readUntrusted = true;
    return finish('executado', action, result.content, result.summary);
  }
}

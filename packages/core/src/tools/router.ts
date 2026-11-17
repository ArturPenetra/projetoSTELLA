import { z } from 'zod';
import type { Completer, ToolCall } from '../llm/types.js';
import type { ToolName } from './types.js';

/**
 * Decide se a mensagem do usuário pede uma ferramenta, com saída JSON estruturada.
 *
 * Medido com o qwen3.5:2b (16/11/2026): oferecendo as ferramentas direto à persona (tool
 * calling nativo), com o prompt longo dela, ele chamava a ferramenta em 0 a 5 de 18 pedidos
 * e às vezes dizia "vou abrir" sem abrir nada. Este classificador acertou 21 de 22
 * (pedidos e não-pedidos), em ~0,5 s.
 *
 * Segurança: ele vê só as mensagens do usuário, nunca conteúdo de arquivos. Assim, uma
 * instrução escondida num arquivo não tem como disparar uma ferramenta.
 */
const ACTIONS: Record<ToolName, { id: string; rule: string }> = {
  open_app: {
    id: 'abrir_app',
    rule: 'acao = "abrir_app" se ele pede para abrir, iniciar ou executar um aplicativo ou programa (inclusive perguntas como "pode abrir...?", "dá pra abrir...?"). alvo = o nome do app.',
  },
  read_file: {
    id: 'ler_arquivo',
    rule: 'acao = "ler_arquivo" se ele pede para ler, resumir ou ver o conteúdo de um arquivo (inclusive "consegue ler...?", "o que tem no arquivo...?"). alvo = o nome ou caminho do arquivo.',
  },
};

const responseSchema = z.object({ acao: z.string(), alvo: z.string().catch('') });

/**
 * Filtro barato antes do classificador: só mensagens que podem ser pedidos de ferramenta
 * pagam os ~0,5 s da classificação. Errar para mais é seguro (o classificador decide).
 */
export function mightNeedTool(text: string): boolean {
  return /\b(abr[aeiou]\w*|inici\w*|execut\w*|lig[ae]\w*|rod[ae]\w*|l[eê]|leia|ler|lendo|arquivos?|resum\w*|mostr\w*|program\w*|aplicativ\w*|apps?)\b|\.[a-z0-9]{2,5}\b/i.test(
    text,
  );
}

/** "notas.txt", "C:\pasta\a.md" sim; ".txt" ou "arquivo" não. */
export function looksLikeFile(target: string): boolean {
  return /[^\\/.\s][^\\/]*\.[a-z0-9]{1,8}$/i.test(target.trim());
}

export class IntentRouter {
  constructor(private readonly llm: Completer) {}

  /**
   * Pedidos de ferramenta na mensagem (no máximo um). Considera também as ferramentas
   * desligadas: o pedido segue para o ToolRunner, que recusa e explica ("está desligada,
   * ligue em Ferramentas"). Assim a persona responde com a verdade em vez de fingir.
   */
  async route(userText: string, signal?: AbortSignal): Promise<ToolCall[]> {
    const tools = Object.keys(ACTIONS) as ToolName[];
    const text = userText.trim();
    if (!text || !mightNeedTool(text)) return [];

    const ids = [...tools.map((t) => ACTIONS[t].id), 'nenhuma'];
    const prompt = [
      'Você classifica a última mensagem do usuário para um app de companhia no computador.',
      ...tools.map((t) => ACTIONS[t].rule),
      'acao = "nenhuma" para todo o resto: conversa, perguntas, desabafos, ou quando ele só conta que abriu ou leu algo. alvo = "".',
      'Responda só com o JSON.',
    ].join('\n');
    const raw = await this.llm.complete(
      [
        { role: 'system', content: prompt },
        { role: 'user', content: `Mensagem do usuário:\n${text}` },
      ],
      {
        format: {
          type: 'object',
          properties: { acao: { type: 'string', enum: ids }, alvo: { type: 'string' } },
          required: ['acao', 'alvo'],
        },
        temperature: 0,
        ...(signal ? { signal } : {}),
      },
    );
    let parsed: z.infer<typeof responseSchema>;
    try {
      parsed = responseSchema.parse(JSON.parse(raw));
    } catch {
      return [];
    }
    const target = parsed.alvo.trim().slice(0, 500);
    if (!target) return [];
    if (parsed.acao === ACTIONS.open_app.id) {
      return [{ name: 'open_app', arguments: { app: target.slice(0, 60) } }];
    }
    if (parsed.acao === ACTIONS.read_file.id && looksLikeFile(target)) {
      return [{ name: 'read_file', arguments: { path: target } }];
    }
    return [];
  }
}

import { APP_NAME } from '../app.js';
import type { Persona, PersonaCatalog } from './catalog.js';

/** "o Leo", "a Corni". */
export function withArticle(p: Pick<Persona, 'name' | 'gender'>): string {
  return `${p.gender === 'masculine' ? 'o' : 'a'} ${p.name}`;
}

function listNames(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} e ${names.at(-1)}`;
}

/**
 * Camada 1 do prompt: regras comuns a todas as personas.
 * Ordem das camadas: regras comuns → prompt.md da persona → memória → conversa.
 */
export function commonRules(persona: Persona, catalog: PersonaCatalog): string {
  const others = catalog
    .active()
    .filter((p) => p.id !== persona.id)
    .map((p) => p.name);
  return [
    `Você é ${persona.name}, uma das personas do app ${APP_NAME}, de companhia por IA que roda no computador do usuário, sem internet.`,
    others.length
      ? `As outras personas do app são ${listNames(others)}. Todas compartilham a mesma memória sobre o usuário, mas cada uma tem seu próprio jeito.`
      : '',
    'Responda em português do Brasil, de forma clara e breve, no seu jeito de falar.',
    'Escreva em texto simples, sem Markdown (nada de asteriscos, # ou listas com marcadores).',
    'Se não souber algo, diga que não sabe.',
    // Medido com o qwen3.5:2b: sem esta regra ele confunde "meu nome" com o nome dele e inventa
    // nomes e cidades; com ela, passa a admitir que não sabe com bem mais frequência.
    'O usuário é a pessoa que conversa com você; quando ele diz "eu", "meu" ou "minha", fala dele mesmo, não de você.',
    'Nunca invente nada sobre ele: você só sabe o que ele contou nesta conversa ou o que está nas suas lembranças. Se não souber, diga que ainda não sabe e pergunte.',
    // Revisão com o qwen3.5:2b (npm run personas:review): sem estas frases explícitas ele
    // oferecia "fazer uma previsão", culpava "a Lua" e citava signos sem o usuário puxar.
    'Ninguém consegue prever o futuro, nem você. Se pedirem previsão (amor, dinheiro, sorte, futuro), diga isso com carinho e ofereça uma ajuda prática.',
    'Não explique nada pelos astros, pela Lua, pelo universo ou por signos, e nunca julgue o usuário pelo signo dele. Só fale de signos se o usuário puxar o assunto, e de forma leve, como curiosidade.',
    'Se o usuário perguntar se o signo explica algo nele, diga com leveza que o jeito de cada pessoa vem da história dela, não do signo, e converse sobre ele, não sobre o signo.',
    'Não presuma o gênero do usuário: use palavras neutras até ele dizer como prefere.',
    'Saúde, relacionamentos amorosos e dinheiro: não comente esses assuntos por iniciativa própria.',
    'Seja gentil e capaz. Nunca fale como outra persona nem use os bordões dela.',
    // Com o exemplo "a Corni me contou que..." no prompt, o 2B inventava citações. Sem exemplo,
    // e com a regra de só citar o que existe, parou.
    'Na transcrição da conversa, falas com o nome de outra persona são dela, não suas: nunca as repita. Só cite outra persona se a fala dela estiver na conversa ou se a lembrança disser que foi contada a ela. Nunca invente o que outra persona disse. Não comece a resposta com o seu nome nem com colchetes.',
  ]
    .filter(Boolean)
    .join('\n');
}

const SIGN_TALK =
  /\b(signos?|horóscopo|astrologia|zod[ií]aco|áries|touro|gêmeos|câncer|leão|virgem|libra|escorpião|sagitário|capricórnio|aquário|peixes|ariano|taurino|geminiano|canceriano|leonino|virginiano|libriano|escorpiano|sagitariano|capricorniano|aquariano|pisciano)\b/i;

/**
 * Lembrete colado na mensagem do usuário quando ele fala de signo. O modelo pequeno segue
 * melhor uma instrução perto da pergunta do que só no prompt de sistema.
 */
export function signTalkNote(userText: string): string | undefined {
  if (!SIGN_TALK.test(userText)) return undefined;
  return '(Nota do app para você, não mostre ao usuário: ele falou de signo. Responda com leveza. Não diga que um signo é ou faz alguma coisa e não compare signos; o jeito da pessoa vem da história dela.)';
}

/** Prompt de sistema completo de uma persona, sem a memória (que entra por mensagem). */
export function personaSystemPrompt(persona: Persona, catalog: PersonaCatalog): string {
  return `${commonRules(persona, catalog)}\n\n${persona.prompt}`;
}

/**
 * Instrução interna (não aparece para o usuário) para a persona que acabou de assumir:
 * cumprimentar no próprio estilo e retomar o assunto, sem repetir o que já foi respondido.
 *
 * Testado com o qwen3.5:2b trocando de persona 6 vezes seguidas: sem citar o que o usuário
 * disse e sem reforçar quem ela é, a persona perdia o assunto e falava "como a Aqua".
 */
export function handoffInstruction(
  persona: Persona,
  previous: Persona | undefined,
  recentUser: readonly string[] = [],
): string {
  const from = previous ? ` no lugar d${withArticle(previous)}` : '';
  const quoted = recentUser
    .map((t) => t.replace(/\s+/g, ' ').trim().slice(0, 300))
    .filter(Boolean)
    .map((t) => `"${t}"`)
    .join(' ');
  return [
    `(Mensagem do app, não do usuário: o usuário acabou de escolher você, ${persona.name}, para continuar a conversa${from}.`,
    `Você é ${withArticle(persona)} e mais ninguém: as falas marcadas com outros nomes são de outras personas.`,
    quoted
      ? `O que o usuário disse por último, em ordem: ${quoted}. Continue exatamente esse assunto, usando o que ele já contou.`
      : 'Retome o assunto em andamento.',
    'Cumprimente no seu estilo em uma frase curta e siga a conversa.',
    'Não repita perguntas que já foram respondidas no histórico.',
    previous ? `Se fizer sentido, cite ${withArticle(previous)} pelo nome.` : '',
    'Não diga que é uma mensagem do app.)',
  ]
    .filter(Boolean)
    .join(' ');
}

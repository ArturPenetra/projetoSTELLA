/**
 * Trocas seguidas de persona com o modelo real (Ollama aberto): o assunto e a identidade
 * precisam continuar estáveis. Roda com `npm run personas:review` e anexa o resultado em
 * test-results/personas-switch.md.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ChatSession,
  DEFAULT_CHAT_MODEL,
  DEFAULT_OLLAMA_URL,
  handoffInstruction,
  loadPersonaCatalog,
  OllamaClient,
  personaSystemPrompt,
  signTalkNote,
  type Persona,
} from '@stella/core';
import { expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '../..');
const catalog = loadPersonaCatalog(join(ROOT, 'personas'));
const llm = new OllamaClient({ baseUrl: DEFAULT_OLLAMA_URL, model: DEFAULT_CHAT_MODEL });

const persona = (id: string) => {
  const p = catalog.get(id);
  if (!p) throw new Error(`persona ${id} ausente`);
  return p;
};
const speaker = (p: Persona) => ({
  id: p.id,
  name: p.name,
  systemPrompt: personaSystemPrompt(p, catalog),
  turnNote: signTalkNote,
});

async function ask(s: ChatSession, text: string, hidden = false): Promise<string> {
  let reply = '';
  for await (const c of s.send(text, { hidden })) if (c.type === 'token') reply += c.text;
  return reply.replace(/\s+/g, ' ').trim();
}

it('trocas seguidas mantêm assunto e identidade', async () => {
  const lines = ['# Trocas seguidas de persona', '', `Modelo: ${DEFAULT_CHAT_MODEL}.`, ''];
  const problems: string[] = [];
  const session = new ChatSession(llm, { speaker: speaker(persona('leo')) });

  for (const text of [
    'Oi, sou o Artur. Quero montar um plano pra correr 5 km em 2 meses.',
    'Hoje consigo correr só 1 km sem parar.',
  ]) {
    lines.push(`**Usuário:** ${text}`, '', `**Leo:** ${await ask(session, text)}`, '');
  }

  // Seis trocas sem o usuário dizer nada, como a ChatController faz.
  let previous = persona('leo');
  for (const id of ['corni', 'aqua', 'pixi', 'leo', 'corni', 'pixi']) {
    const next = persona(id);
    session.setSpeaker(speaker(next));
    session.dropPendingHandoffs();
    const reply = await ask(
      session,
      handoffInstruction(next, previous, session.recentUserMessages()),
      true,
    );
    const others = catalog.active().filter((p) => p.id !== next.id);
    // "Como Aqua, sou..." ou "eu sou a Aqua" é falar como outra; "como o Leo disse" é citar.
    const wrongIdentity = others.find((p) =>
      new RegExp(`(\\bcomo ${p.name}\\s*,|\\b(eu )?sou (o |a )?${p.name}\\b)`, 'i').test(reply),
    );
    // A própria fala repetida palavra por palavra de outra persona.
    const copied = session.messages.find(
      (m) =>
        m.speakerId &&
        m.speakerId !== next.id &&
        m.content.length > 40 &&
        reply.includes(m.content),
    );
    if (copied)
      problems.push(
        `${next.name} repetiu uma fala d${copied.speakerName === 'Leo' ? 'o' : 'a'} ${copied.speakerName}`,
      );
    if (wrongIdentity) problems.push(`${next.name} falou como ${wrongIdentity.name}`);
    if (/qual (é )?(o )?seu nome|como (você )?se chama|como posso te chamar/i.test(reply)) {
      problems.push(`${next.name} perguntou o nome de novo`);
    }
    lines.push(`**${next.name} (assumindo):** ${reply}`, '');
    previous = next;
  }

  const handoffsInHistory = session.messages.filter((m) => m.handoff).length;
  if (handoffsInHistory !== 1) problems.push(`${handoffsInHistory} cumprimentos no histórico`);

  const question = 'Então, qual era o meu objetivo mesmo e quanto eu corro hoje?';
  const final = await ask(session, question);
  lines.push(`**Usuário:** ${question}`, '', `**Pixi:** ${final}`, '');
  if (!/\b5\s?(km|quil)|cinco quil/i.test(final)) {
    problems.push('a resposta final esqueceu o objetivo (5 km)');
  }
  if (!/\b1\s?(km|quil)|um quil/i.test(final))
    problems.push('a resposta final esqueceu quanto ele corre (1 km)');

  lines.push(
    '## Resumo',
    '',
    problems.length ? problems.map((p) => `- ⚠️ ${p}`).join('\n') : '- ✅ Sem problemas.',
    '',
  );
  mkdirSync(join(ROOT, 'test-results'), { recursive: true });
  writeFileSync(join(ROOT, 'test-results', 'personas-switch.md'), lines.join('\n'));
  expect(problems).toEqual([]);
}, 600_000);

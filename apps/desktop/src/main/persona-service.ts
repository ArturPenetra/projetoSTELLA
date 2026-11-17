import { readFileSync } from 'node:fs';
import {
  ELEMENTS,
  handoffInstruction,
  isValidDayMonth,
  personaSystemPrompt,
  signTalkNote,
  PREFERENCES,
  SIGN_NAMES,
  SIGNS,
  signsForDate,
  suggest,
  suggestionReason,
  type ElementId,
  type Memory,
  type Persona,
  type PersonaCatalog,
  type Preference,
  type SignId,
} from '@stella/core';
import { z } from 'zod';
import type {
  FinishOnboarding,
  Palette,
  PersonaState,
  PersonaView,
  SuggestionView,
} from '../shared/ipc.js';
import type { ChatController, ChatSpeaker } from './chat-controller.js';
import type { Profile, ProfileStore } from './profile.js';

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const paletteSchema = z.object({ primaria: hex, secundaria: hex, profunda: hex, brilho: hex });
const elementsSchema = z.object(
  Object.fromEntries(ELEMENTS.map((e) => [e, paletteSchema])) as Record<
    ElementId,
    typeof paletteSchema
  >,
);
export type Palettes = Record<ElementId, Palette>;

/** Lê config/elements.json (as 4 paletas). */
export function loadPalettes(path: string): Palettes {
  return elementsSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

const ASK_NAME = 'Como posso te chamar?';

/** Se a memória já sabe o nome do usuário (para a persona não perguntar de novo). */
function knowsName(memory: Memory | undefined): boolean {
  return (memory?.listFacts() ?? []).some((f) =>
    /\b(se chama|nome|chamad[oa]|apelido)\b/i.test(f.text),
  );
}

/**
 * Personas no app: catálogo, escolha do usuário (profile.json), onboarding e troca.
 * Não depende do Electron.
 */
export class PersonaService {
  private persona: Persona;
  private listeners = new Set<(p: PersonaView) => void>();

  constructor(
    private readonly catalog: PersonaCatalog,
    private readonly palettes: Palettes,
    private readonly store: ProfileStore,
    private profile: Profile,
    private readonly chat: () => ChatController | undefined,
    private readonly memory?: Memory,
  ) {
    const saved = profile.personaId;
    this.persona =
      saved && catalog.isActive(saved) ? (catalog.get(saved) as Persona) : catalog.defaultPersona();
  }

  get current(): Persona {
    return this.persona;
  }

  get onboarded(): boolean {
    return this.profile.onboarded;
  }

  /** Para o ChatController: quem responde e com qual prompt. */
  speaker(persona: Persona = this.persona): ChatSpeaker {
    return {
      id: persona.id,
      name: persona.name,
      element: persona.element,
      systemPrompt: personaSystemPrompt(persona, this.catalog),
      turnNote: signTalkNote,
    };
  }

  /** "ao Leo", "à Corni": como a memória cita quem ouviu um fato. */
  label(personaId: string): string | undefined {
    const p = this.catalog.get(personaId);
    if (!p) return undefined;
    return p.gender === 'masculine' ? `ao ${p.name}` : `à ${p.name}`;
  }

  view(p: Persona): PersonaView {
    return {
      id: p.id,
      name: p.name,
      element: p.element,
      status: p.status,
      gender: p.gender,
      role: p.role,
      coreTrait: p.coreTrait,
      greeting: p.greeting,
      sign: p.sign,
      signName: SIGN_NAMES[p.sign],
      palette: this.palettes[p.element],
    };
  }

  state(): PersonaState {
    return {
      current: this.view(this.persona),
      personas: this.catalog.all().map((p) => this.view(p)),
      onboarded: this.profile.onboarded,
      sign: this.profile.sign,
      preference: this.profile.preference,
      signs: SIGNS.map((id) => ({ id, name: SIGN_NAMES[id] })),
    };
  }

  onChanged(listener: (p: PersonaView) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private requireActive(id: unknown): Persona {
    if (typeof id !== 'string') throw new Error('Persona inválida.');
    const persona = this.catalog.get(id);
    if (!persona) throw new Error('Persona inválida.');
    if (persona.status !== 'active') throw new Error(`${persona.name} chega em breve.`);
    return persona;
  }

  /** Troca a persona. A nova cumprimenta no próprio estilo e retoma o assunto. */
  async select(id: unknown): Promise<void> {
    const next = this.requireActive(id);
    if (next.id === this.persona.id) return;
    const previous = this.persona;
    await this.apply(next);
    await this.chat()?.switchTo(this.speaker(next), {
      handoff: (recent) => handoffInstruction(next, previous, recent),
      greeting: next.greeting,
    });
  }

  suggest(sign: unknown, preference: unknown): SuggestionView {
    const s = z.enum(SIGNS).safeParse(sign);
    const p = z.enum(PREFERENCES).safeParse(preference);
    if (!s.success || !p.success) throw new Error('Signo ou preferência inválidos.');
    const result = suggest(this.catalog, s.data, p.data);
    return {
      persona: this.view(result.persona),
      ideal: this.view(result.ideal),
      standIn: result.standIn,
      reason: suggestionReason(result, p.data),
    };
  }

  signsForDate(day: unknown, month: unknown): SignId[] {
    if (typeof day !== 'number' || typeof month !== 'number' || !isValidDayMonth(day, month)) {
      throw new Error('Essa data não existe. Confira o dia e o mês.');
    }
    return signsForDate(day, month);
  }

  /**
   * Fim do onboarding: salva signo e preferência (nunca a data), escolhe a persona e
   * começa a primeira conversa. Se a memória ainda não sabe o nome, ela pergunta.
   */
  async finishOnboarding(choice: unknown): Promise<void> {
    const parsed = z
      .object({
        personaId: z.string(),
        sign: z.enum(SIGNS).nullable(),
        preference: z.enum(PREFERENCES).nullable(),
      })
      .safeParse(choice);
    if (!parsed.success) throw new Error('Escolha inválida.');
    const { personaId, sign, preference }: FinishOnboarding = parsed.data;
    const persona = this.requireActive(personaId);
    // Refazer a sugestão e ficar com a mesma persona não precisa de novo cumprimento.
    const unchanged = this.profile.onboarded && persona.id === this.persona.id;

    this.profile = {
      ...this.profile,
      onboarded: true,
      sign,
      preference: sign ? (preference as Preference | null) : null,
    };
    await this.apply(persona);

    const chat = this.chat();
    if (!chat || unchanged) return;
    const greeting = knowsName(this.memory) ? persona.greeting : `${persona.greeting} ${ASK_NAME}`;
    if (chat.hasConversation) {
      await chat.switchTo(this.speaker(persona), {
        handoff: (recent) => handoffInstruction(persona, undefined, recent),
      });
    } else {
      await chat.switchTo(this.speaker(persona), { greeting });
    }
  }

  private async apply(persona: Persona): Promise<void> {
    this.persona = persona;
    this.profile = { ...this.profile, personaId: persona.id };
    await this.store.save(this.profile);
    const view = this.view(persona);
    for (const l of this.listeners) l(view);
  }
}

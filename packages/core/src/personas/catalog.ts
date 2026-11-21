import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { ELEMENTS, SIGNS, type ElementId, type SignId } from './zodiac.js';

const personaFileSchema = z.object({
  /** Igual ao nome da pasta: letras minúsculas, números e hífen. */
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().trim().min(1).max(40),
  sign: z.enum(SIGNS),
  element: z.enum(ELEMENTS),
  /** "active" pode ser escolhida; "planned" aparece no catálogo como "em breve". */
  status: z.enum(['active', 'planned']),
  /** Como a persona fala de si mesma em português. */
  gender: z.enum(['feminine', 'masculine']),
  role: z.string().trim().min(1),
  coreTrait: z.string().trim().min(1),
  unexpectedSide: z.string().trim().min(1),
  voice: z
    .object({
      engine: z.string(),
      voiceId: z.string(),
      speed: z.number().positive().max(3),
    })
    .optional(),
  /**
   * Como o reconhecimento de voz costuma ouvir o nome ("Pixie", "Corney"). O texto ouvido
   * troca essas variantes pelo nome (`createNameFixer`, docs/voz-modelos.md).
   */
  heardAs: z.array(z.string().trim().min(1).max(40)).max(40).default([]),
  /** Primeira fala ao ser escolhida, no estilo dela. */
  greeting: z.string().trim().min(1),
  /** Signos cuja persona ideal ainda não existe e que esta persona assume. */
  fallbackFor: z.array(z.enum(SIGNS)).default([]),
});

export type PersonaFile = z.infer<typeof personaFileSchema>;

export interface Persona extends PersonaFile {
  /** Conteúdo do prompt.md (obrigatório para as ativas). */
  prompt: string;
}

export class PersonaCatalogError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Problemas no catálogo de personas:\n- ${problems.join('\n- ')}`);
    this.name = 'PersonaCatalogError';
  }
}

/**
 * Catálogo de personas. Persona é dado, não código: cada uma é uma pasta em `personas/`
 * com `persona.json` e, se ativa, `prompt.md`. A ordem segue o zodíaco.
 */
export class PersonaCatalog {
  private readonly byId: Map<string, Persona>;

  constructor(personas: Persona[]) {
    const problems = validateCatalog(personas);
    if (problems.length) throw new PersonaCatalogError(problems);
    this.byId = new Map(
      [...personas]
        .sort((a, b) => SIGNS.indexOf(a.sign) - SIGNS.indexOf(b.sign))
        .map((p) => [p.id, p]),
    );
  }

  all(): Persona[] {
    return [...this.byId.values()];
  }

  active(): Persona[] {
    return this.all().filter((p) => p.status === 'active');
  }

  get(id: string): Persona | undefined {
    return this.byId.get(id);
  }

  isActive(id: string): boolean {
    return this.byId.get(id)?.status === 'active';
  }

  /** A persona do signo (cada signo tem exatamente uma). */
  forSign(sign: SignId): Persona {
    return this.all().find((p) => p.sign === sign) as Persona;
  }

  /** Persona ativa do elemento (a primeira na ordem do zodíaco). */
  activeForElement(element: ElementId): Persona | undefined {
    return this.active().find((p) => p.element === element);
  }

  /**
   * Quem assume enquanto a persona do signo não está ativa: a ativa que declara
   * `fallbackFor` com esse signo ou, se nenhuma declarar, a ativa do mesmo elemento.
   */
  standInFor(sign: SignId): Persona | undefined {
    const ideal = this.forSign(sign);
    if (ideal.status === 'active') return ideal;
    return (
      this.active().find((p) => p.fallbackFor.includes(sign)) ??
      this.activeForElement(ideal.element)
    );
  }

  /** Primeira persona ativa, para quando não há escolha salva. */
  defaultPersona(): Persona {
    return this.active()[0] as Persona;
  }
}

function validateCatalog(personas: Persona[]): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  const signs = new Map<SignId, string>();
  for (const p of personas) {
    if (ids.has(p.id)) problems.push(`id repetido: ${p.id}`);
    ids.add(p.id);
    const other = signs.get(p.sign);
    if (other) problems.push(`${p.id} e ${other} têm o mesmo signo (${p.sign})`);
    signs.set(p.sign, p.id);
    if (p.status === 'active' && !p.prompt.trim()) {
      problems.push(`${p.id} está ativa mas não tem prompt.md`);
    }
  }
  for (const sign of SIGNS) {
    if (!signs.has(sign)) problems.push(`nenhuma persona para o signo ${sign}`);
  }
  if (!personas.some((p) => p.status === 'active')) problems.push('nenhuma persona ativa');
  return problems;
}

/** Lê e valida uma persona a partir dos arquivos (sem tocar no disco). */
export function parsePersona(id: string, json: unknown, prompt: string): Persona {
  const parsed = personaFileSchema.safeParse(json);
  if (!parsed.success) {
    throw new PersonaCatalogError(
      parsed.error.issues.map(
        (i) => `${id}/persona.json → ${i.path.join('.') || '(raiz)'}: ${i.message}`,
      ),
    );
  }
  if (parsed.data.id !== id) {
    throw new PersonaCatalogError([`${id}/persona.json: o id "${parsed.data.id}" difere da pasta`]);
  }
  return { ...parsed.data, prompt: prompt.trim() };
}

/** Carrega todas as pastas de `dir` que tenham `persona.json`. */
export function loadPersonaCatalog(dir: string): PersonaCatalog {
  const personas: Persona[] = [];
  const problems: string[] = [];
  for (const id of readdirSync(dir).sort()) {
    const folder = join(dir, id);
    const jsonPath = join(folder, 'persona.json');
    if (!statSync(folder).isDirectory() || !existsSync(jsonPath)) continue;
    try {
      const json: unknown = JSON.parse(readFileSync(jsonPath, 'utf8'));
      const promptPath = join(folder, 'prompt.md');
      const prompt = existsSync(promptPath) ? readFileSync(promptPath, 'utf8') : '';
      personas.push(parsePersona(id, json, prompt));
    } catch (err) {
      if (err instanceof PersonaCatalogError) problems.push(...err.problems);
      else problems.push(`${id}/persona.json não é um JSON válido`);
    }
  }
  if (problems.length) throw new PersonaCatalogError(problems);
  return new PersonaCatalog(personas);
}

import type { Persona, PersonaCatalog } from './catalog.js';
import { elementOf, signAt, type ElementId, type SignId } from './zodiac.js';

export const PREFERENCES = ['similar', 'compatible', 'contrast'] as const;
export type Preference = (typeof PREFERENCES)[number];

export const PREFERENCE_LABELS: Record<Preference, string> = {
  similar: 'Mais parecida comigo',
  compatible: 'Maior compatibilidade',
  contrast: 'Maior contraste',
};

const OPPOSITE: Record<ElementId, ElementId> = {
  fogo: 'agua',
  agua: 'fogo',
  terra: 'ar',
  ar: 'terra',
};

/**
 * Signo ideal para cada preferência (astrologia tradicional, aplicada de forma leve):
 * - parecida: o próprio signo;
 * - compatível: dois signos à frente (sextil), sempre de elemento complementar;
 * - contraste: o signo a três casas (quadratura) que cai no elemento oposto.
 */
export function idealSign(sign: SignId, preference: Preference): SignId {
  switch (preference) {
    case 'similar':
      return sign;
    case 'compatible':
      return signAt(sign, 2);
    case 'contrast': {
      const forward = signAt(sign, 3);
      return elementOf(forward) === OPPOSITE[elementOf(sign)] ? forward : signAt(sign, -3);
    }
  }
}

export interface Suggestion {
  /** Persona ideal pelas regras (pode ainda não estar ativa). */
  ideal: Persona;
  /** Quem conversa de fato: a ideal, se ativa, ou a substituta. */
  persona: Persona;
  /** Se a ideal ainda não existe e outra assume no lugar. */
  standIn: boolean;
}

export function suggest(catalog: PersonaCatalog, sign: SignId, preference: Preference): Suggestion {
  const ideal = catalog.forSign(idealSign(sign, preference));
  const persona = catalog.standInFor(ideal.sign);
  if (!persona) throw new Error(`Nenhuma persona ativa para assumir no lugar de ${ideal.name}.`);
  return { ideal, persona, standIn: persona.id !== ideal.id };
}

/** Tabela completa (12 signos × 3 preferências), no formato de config/affinity.json. */
export function affinityTable(catalog: PersonaCatalog) {
  return Object.fromEntries(
    catalog.all().map((p) => [
      p.sign,
      Object.fromEntries(
        (['similar', 'compatible', 'contrast'] as const).map((pref) => {
          const s = suggest(catalog, p.sign, pref);
          return [pref, { ideal: s.ideal.id, persona: s.persona.id }];
        }),
      ),
    ]),
  );
}

/** Motivo da sugestão, em uma frase, para mostrar no onboarding. */
export function suggestionReason(s: Suggestion, preference: Preference): string {
  const why: Record<Preference, string> = {
    similar: `${s.ideal.name} tem o mesmo jeito de ser que você.`,
    compatible: `${s.ideal.name} costuma complementar bem o seu jeito.`,
    contrast: `${s.ideal.name} é bem diferente de você e pode te tirar da zona de conforto.`,
  };
  if (!s.standIn) return why[preference];
  const idealArticle = article(s.ideal) === 'o' ? 'O' : 'A';
  return `${why[preference]} ${idealArticle} ${s.ideal.name} chega em breve. Enquanto isso, ${article(s.persona)} ${s.persona.name}, do mesmo elemento, fica com você.`;
}

/** "o" ou "a", conforme como a persona fala de si. */
export function article(p: Pick<Persona, 'gender'>): 'o' | 'a' {
  return p.gender === 'masculine' ? 'o' : 'a';
}

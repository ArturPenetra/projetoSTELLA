/** Os 12 signos, na ordem do zodíaco (a ordem importa para a afinidade). */
export const SIGNS = [
  'aries',
  'taurus',
  'gemini',
  'cancer',
  'leo',
  'virgo',
  'libra',
  'scorpio',
  'sagittarius',
  'capricorn',
  'aquarius',
  'pisces',
] as const;
export type SignId = (typeof SIGNS)[number];

export const ELEMENTS = ['fogo', 'terra', 'ar', 'agua'] as const;
export type ElementId = (typeof ELEMENTS)[number];

/** Nome do signo em português. */
export const SIGN_NAMES: Record<SignId, string> = {
  aries: 'Áries',
  taurus: 'Touro',
  gemini: 'Gêmeos',
  cancer: 'Câncer',
  leo: 'Leão',
  virgo: 'Virgem',
  libra: 'Libra',
  scorpio: 'Escorpião',
  sagittarius: 'Sagitário',
  capricorn: 'Capricórnio',
  aquarius: 'Aquário',
  pisces: 'Peixes',
};

export const ELEMENT_NAMES: Record<ElementId, string> = {
  fogo: 'Fogo',
  terra: 'Terra',
  ar: 'Ar',
  agua: 'Água',
};

/** Fogo, terra, ar, água, repetindo na ordem do zodíaco. */
export function elementOf(sign: SignId): ElementId {
  return ELEMENTS[SIGNS.indexOf(sign) % 4] as ElementId;
}

/** Signo `steps` casas à frente (negativo: para trás). */
export function signAt(sign: SignId, steps: number): SignId {
  return SIGNS[(((SIGNS.indexOf(sign) + steps) % 12) + 12) % 12] as SignId;
}

/** Primeiro dia de cada signo (dia, mês), conforme a tabela da especificação. */
const STARTS: Record<SignId, [day: number, month: number]> = {
  aries: [21, 3],
  taurus: [20, 4],
  gemini: [21, 5],
  cancer: [21, 6],
  leo: [23, 7],
  virgo: [23, 8],
  libra: [23, 9],
  scorpio: [23, 10],
  sagittarius: [22, 11],
  capricorn: [22, 12],
  aquarius: [20, 1],
  pisces: [19, 2],
};

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function isValidDayMonth(day: number, month: number): boolean {
  return (
    Number.isInteger(day) &&
    Number.isInteger(month) &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= (DAYS_IN_MONTH[month - 1] ?? 0)
  );
}

/** Posição do dia no ano (sem ano bissexto; 29/02 fica junto de 28/02 para comparar). */
function dayOfYear(day: number, month: number): number {
  let n = day;
  for (let m = 1; m < month; m++) n += DAYS_IN_MONTH[m - 1] ?? 0;
  return n;
}

/**
 * Signo da data de nascimento. Os limites variam um dia conforme o ano, então quem nasceu
 * no primeiro ou no último dia de um signo recebe os dois para escolher.
 * Devolve 1 signo, ou 2 (o mais provável primeiro) no limite.
 */
export function signsForDate(day: number, month: number): SignId[] {
  if (!isValidDayMonth(day, month)) throw new RangeError('Data inválida.');
  const target = dayOfYear(day, month);
  // O signo é o último cujo começo é <= a data; antes de 20/01 ainda é Capricórnio.
  let sign: SignId = 'capricorn';
  let best = -1;
  for (const s of SIGNS) {
    const [d, m] = STARTS[s];
    const start = dayOfYear(d, m);
    if (start <= target && start > best) {
      best = start;
      sign = s;
    }
  }
  const [sd, sm] = STARTS[sign];
  const next = signAt(sign, 1);
  const [nd, nm] = STARTS[next];
  const isFirstDay = sd === day && sm === month;
  const isLastDay = target === dayOfYear(nd, nm) - 1;
  if (isFirstDay) return [sign, signAt(sign, -1)];
  if (isLastDay) return [sign, next];
  return [sign];
}

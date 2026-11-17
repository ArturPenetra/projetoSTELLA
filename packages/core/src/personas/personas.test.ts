import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  affinityTable,
  idealSign,
  suggest,
  suggestionReason,
  type Preference,
} from './affinity.js';
import { loadPersonaCatalog, PersonaCatalog, PersonaCatalogError } from './catalog.js';
import { commonRules, handoffInstruction, personaSystemPrompt, withArticle } from './prompt.js';
import { elementOf, signAt, signsForDate, SIGNS, type SignId } from './zodiac.js';

const PERSONAS_DIR = join(import.meta.dirname, '../../../../personas');
const AFFINITY_FILE = join(import.meta.dirname, '../../../../config/affinity.json');
const catalog = loadPersonaCatalog(PERSONAS_DIR);

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Cópia da pasta personas/ para mexer nos arquivos sem tocar nos de verdade. */
function copyPersonas(): string {
  const dir = mkdtempSync(join(tmpdir(), 'stella-personas-'));
  tmpDirs.push(dir);
  cpSync(PERSONAS_DIR, dir, { recursive: true });
  return dir;
}

describe('zodíaco', () => {
  it('elementos se repetem na ordem fogo, terra, ar, água', () => {
    expect(SIGNS.map(elementOf).slice(0, 4)).toEqual(['fogo', 'terra', 'ar', 'agua']);
    expect(elementOf('pisces')).toBe('agua');
    expect(signAt('pisces', 1)).toBe('aries');
    expect(signAt('aries', -3)).toBe('capricorn');
  });

  it('calcula o signo pela data, conforme a tabela da especificação', () => {
    const cases: [number, number, SignId][] = [
      [25, 3, 'aries'],
      [1, 5, 'taurus'],
      [10, 6, 'gemini'],
      [4, 7, 'cancer'],
      [1, 8, 'leo'],
      [1, 9, 'virgo'],
      [1, 10, 'libra'],
      [1, 11, 'scorpio'],
      [1, 12, 'sagittarius'],
      [1, 1, 'capricorn'],
      [31, 12, 'capricorn'],
      [1, 2, 'aquarius'],
      [1, 3, 'pisces'],
      [29, 2, 'pisces'],
    ];
    for (const [d, m, sign] of cases) expect(signsForDate(d, m), `${d}/${m}`).toEqual([sign]);
  });

  it('no limite entre dois signos, devolve os dois para o usuário escolher', () => {
    expect(signsForDate(21, 3)).toEqual(['aries', 'pisces']);
    expect(signsForDate(20, 3)).toEqual(['pisces', 'aries']);
    expect(signsForDate(19, 1)).toEqual(['capricorn', 'aquarius']);
    expect(signsForDate(22, 12)).toEqual(['capricorn', 'sagittarius']);
    expect(signsForDate(21, 12)).toEqual(['sagittarius', 'capricorn']);
  });

  it('recusa data inválida', () => {
    expect(() => signsForDate(31, 4)).toThrow(RangeError);
    expect(() => signsForDate(0, 1)).toThrow(RangeError);
    expect(() => signsForDate(1, 13)).toThrow(RangeError);
  });
});

describe('catálogo', () => {
  it('tem as 12 personas e só as 4 iniciais estão ativas', () => {
    expect(catalog.all().map((p) => p.id)).toEqual([
      'ari',
      'tauri',
      'gemi',
      'canci',
      'leo',
      'vivi',
      'libi',
      'corp',
      'sagi',
      'corni',
      'aqua',
      'pixi',
    ]);
    expect(catalog.active().map((p) => p.name)).toEqual(['Leo', 'Corni', 'Aqua', 'Pixi']);
    expect(catalog.active().every((p) => p.prompt.length > 100)).toBe(true);
    expect(catalog.get('leo')?.gender).toBe('masculine');
  });

  it('uma persona nova é só uma pasta nova, sem mudar código', () => {
    const dir = copyPersonas();
    // Vira ativa uma futura: basta o JSON e um prompt.md.
    const path = join(dir, 'ari', 'persona.json');
    const json = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    writeFileSync(path, JSON.stringify({ ...json, status: 'active' }));
    writeFileSync(join(dir, 'ari', 'prompt.md'), 'Você é a Ari. Proponha sempre o primeiro passo.');

    const changed = loadPersonaCatalog(dir);
    expect(changed.active().map((p) => p.id)).toEqual(['ari', 'leo', 'corni', 'aqua', 'pixi']);
  });

  it('explica o que está errado nos arquivos', () => {
    const broken = copyPersonas();
    writeFileSync(join(broken, 'leo', 'persona.json'), '{"id":"leo","name":"Leo"}');
    writeFileSync(join(broken, 'corni', 'persona.json'), 'isto não é json');
    expect(() => loadPersonaCatalog(broken)).toThrow('leo/persona.json → sign');
    expect(() => loadPersonaCatalog(broken)).toThrow('corni/persona.json não é um JSON válido');

    const noPrompt = copyPersonas();
    writeFileSync(join(noPrompt, 'pixi', 'prompt.md'), '   ');
    expect(() => loadPersonaCatalog(noPrompt)).toThrow(PersonaCatalogError);
    expect(() => loadPersonaCatalog(noPrompt)).toThrow(/pixi está ativa mas não tem prompt.md/);
  });

  it('exige uma persona por signo e id igual ao nome da pasta', () => {
    const leo = catalog.get('leo');
    if (!leo) throw new Error('sem leo');
    expect(() => new PersonaCatalog([leo])).toThrow(/nenhuma persona para o signo aries/);
    const dir = copyPersonas();
    const path = join(dir, 'aqua', 'persona.json');
    const json = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    writeFileSync(path, JSON.stringify({ ...json, id: 'outra' }));
    expect(() => loadPersonaCatalog(dir)).toThrow(/difere da pasta/);
  });
});

/**
 * Tabela de afinidade da especificação, linha por linha: [ideal, quem assume hoje].
 * "Ari → Leo" vira ['ari', 'leo']; um nome ativo sozinho vira ['leo', 'leo'].
 */
const SPEC_TABLE: Record<SignId, Record<Preference, [string, string]>> = {
  aries: { similar: ['ari', 'leo'], compatible: ['gemi', 'aqua'], contrast: ['canci', 'pixi'] },
  taurus: {
    similar: ['tauri', 'corni'],
    compatible: ['canci', 'pixi'],
    contrast: ['aqua', 'aqua'],
  },
  gemini: { similar: ['gemi', 'aqua'], compatible: ['leo', 'leo'], contrast: ['vivi', 'corni'] },
  cancer: { similar: ['canci', 'pixi'], compatible: ['vivi', 'corni'], contrast: ['ari', 'leo'] },
  leo: { similar: ['leo', 'leo'], compatible: ['libi', 'aqua'], contrast: ['corp', 'pixi'] },
  virgo: { similar: ['vivi', 'corni'], compatible: ['corp', 'pixi'], contrast: ['gemi', 'aqua'] },
  libra: { similar: ['libi', 'aqua'], compatible: ['sagi', 'leo'], contrast: ['corni', 'corni'] },
  scorpio: { similar: ['corp', 'pixi'], compatible: ['corni', 'corni'], contrast: ['leo', 'leo'] },
  sagittarius: {
    similar: ['sagi', 'leo'],
    compatible: ['aqua', 'aqua'],
    contrast: ['pixi', 'pixi'],
  },
  capricorn: {
    similar: ['corni', 'corni'],
    compatible: ['pixi', 'pixi'],
    contrast: ['libi', 'aqua'],
  },
  aquarius: { similar: ['aqua', 'aqua'], compatible: ['ari', 'leo'], contrast: ['tauri', 'corni'] },
  pisces: { similar: ['pixi', 'pixi'], compatible: ['tauri', 'corni'], contrast: ['sagi', 'leo'] },
};

describe('afinidade', () => {
  it('confere as 36 sugestões da especificação, com as substituições das 4 ativas', () => {
    let checked = 0;
    for (const sign of SIGNS) {
      for (const pref of ['similar', 'compatible', 'contrast'] as const) {
        const s = suggest(catalog, sign, pref);
        const [ideal, persona] = SPEC_TABLE[sign][pref];
        expect([s.ideal.id, s.persona.id], `${sign} / ${pref}`).toEqual([ideal, persona]);
        expect(s.standIn).toBe(ideal !== persona);
        checked++;
      }
    }
    expect(checked).toBe(36);
  });

  it('contraste é a quadratura no elemento oposto', () => {
    expect(idealSign('aries', 'contrast')).toBe('cancer');
    expect(idealSign('taurus', 'contrast')).toBe('aquarius');
  });

  it('ativar uma persona futura muda as sugestões dela automaticamente', () => {
    const dir = copyPersonas();
    const path = join(dir, 'ari', 'persona.json');
    const json = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    writeFileSync(path, JSON.stringify({ ...json, status: 'active' }));
    writeFileSync(join(dir, 'ari', 'prompt.md'), 'Você é a Ari.');
    const withAri = loadPersonaCatalog(dir);

    expect(suggest(catalog, 'aries', 'similar').persona.id).toBe('leo');
    expect(suggest(withAri, 'aries', 'similar')).toMatchObject({
      persona: { id: 'ari' },
      standIn: false,
    });
    expect(suggest(withAri, 'cancer', 'contrast').persona.id).toBe('ari');
    expect(suggest(withAri, 'aquarius', 'compatible').persona.id).toBe('ari');
    // As outras sugestões não mudam.
    expect(suggest(withAri, 'leo', 'similar').persona.id).toBe('leo');
  });

  it('config/affinity.json está em dia com as regras (npm run personas:affinity)', () => {
    if (process.env['UPDATE_AFFINITY'] === '1') {
      const generated = {
        $comment:
          'Gerado por "npm run personas:affinity" a partir de personas/. Para cada signo e preferência: a persona ideal e quem conversa hoje (a ideal, se ativa, ou a substituta do mesmo elemento). Não edite à mão.',
        table: affinityTable(catalog),
      };
      writeFileSync(AFFINITY_FILE, JSON.stringify(generated, null, 2) + String.fromCharCode(10));
    }
    const file = JSON.parse(readFileSync(AFFINITY_FILE, 'utf8')) as { table: unknown };
    expect(file.table).toEqual(affinityTable(catalog));
  });

  it('explica o motivo e quem assume enquanto a ideal não chega', () => {
    expect(suggestionReason(suggest(catalog, 'leo', 'similar'), 'similar')).toBe(
      'Leo tem o mesmo jeito de ser que você.',
    );
    expect(suggestionReason(suggest(catalog, 'aries', 'similar'), 'similar')).toBe(
      'Ari tem o mesmo jeito de ser que você. A Ari chega em breve. Enquanto isso, o Leo, do mesmo elemento, fica com você.',
    );
  });
});

describe('prompt das personas', () => {
  const leo = catalog.get('leo');
  const pixi = catalog.get('pixi');
  if (!leo || !pixi) throw new Error('personas iniciais ausentes');

  it('monta as camadas: regras comuns e depois o prompt.md', () => {
    const prompt = personaSystemPrompt(leo, catalog);
    expect(prompt.startsWith(commonRules(leo, catalog))).toBe(true);
    expect(prompt.endsWith(leo.prompt)).toBe(true);
    expect(commonRules(leo, catalog)).toContain(
      'As outras personas do app são Corni, Aqua e Pixi.',
    );
  });

  it('as regras comuns proíbem previsões e julgamento pelo signo', () => {
    const rules = commonRules(pixi, catalog);
    expect(rules).toMatch(/Ninguém consegue prever o futuro/);
    expect(rules).toMatch(/Não explique nada pelos astros, pela Lua/);
    expect(rules).toMatch(/Nunca invente o que outra persona disse/);
    expect(rules).not.toMatch(/me contou que/);
    expect(rules).toMatch(/Só fale de signos se o usuário puxar o assunto/);
    expect(rules).toMatch(/Nunca fale como outra persona/);
  });

  it('instrução de troca cita a persona anterior com o artigo certo', () => {
    expect(withArticle(leo)).toBe('o Leo');
    expect(withArticle(pixi)).toBe('a Pixi');
    const text = handoffInstruction(pixi, leo);
    expect(text).toContain('no lugar do Leo');
    expect(text).toContain('cite o Leo pelo nome');
    expect(text).toContain('Não repita perguntas que já foram respondidas');
  });
});

import { describe, expect, it } from 'vitest';
import { createNameFixer, foldName, nameEntries, STELLA_NAME } from './names.js';

const fix = createNameFixer(
  nameEntries([
    { name: 'Leo', heardAs: ['Léo', 'Leu'] },
    { name: 'Corni', heardAs: ['Corney', 'Corny', 'Cor ni'] },
    { name: 'Aqua', heardAs: ['Água', 'Equa'] },
    { name: 'Pixi', heardAs: ['Pixie', 'Pichi', 'Pix'] },
  ]),
);

describe('createNameFixer', () => {
  it('troca variantes que não são palavras em qualquer lugar', () => {
    expect(fix('Corney organiza minha semana.')).toBe('Corni organiza minha semana.');
    expect(fix('Oi, Pixie, tudo bem?')).toBe('Oi, Pixi, tudo bem?');
    expect(fix('Troca para a Equa.')).toBe('Troca para a Aqua.');
    expect(fix('A pichi é muito divertida.')).toBe('A Pixi é muito divertida.');
    expect(fix('Léo abre o bloco de notas.')).toBe('Leo abre o bloco de notas.');
  });

  it('ignora maiúsculas e acentos, mas só em palavras inteiras', () => {
    expect(fix('obrigada, CORNY!')).toBe('obrigada, Corni!');
    expect(fix('Leo, o Leonardo chegou.')).toBe('Leo, o Leonardo chegou.');
    expect(fix('Pixies são fadas.')).toBe('Pixies são fadas.');
  });

  it('variantes de mais de uma palavra, só com espaço entre elas', () => {
    expect(fix('Oi Cor ni, tudo certo?')).toBe('Oi Corni, tudo certo?');
    expect(fix('Cor, ni')).toBe('Cor, ni');
  });

  it('o nome certo continua igual, com a grafia do nome', () => {
    expect(fix('oi aqua')).toBe('oi Aqua');
    expect(fix('Tudo bem, Pixi?')).toBe('Tudo bem, Pixi?');
  });

  it('"Estela" e "Tela" viram Stella (Tela só chamando)', () => {
    expect(fix('Oi, Estela, tudo bem?')).toBe('Oi, Stella, tudo bem?');
    expect(fix('Tela abre a calculadora.')).toBe('Stella abre a calculadora.');
    expect(fix('Tela, que horas são?')).toBe('Stella, que horas são?');
    expect(fix('Comprei uma tela nova.')).toBe('Comprei uma tela nova.');
    expect(fix('A tela quebrou.')).toBe('A tela quebrou.');
    expect(fix('Tela quebrada não liga.')).toBe('Tela quebrada não liga.');
  });

  describe('palavra comum ("água", "pix", "leu") só vira nome quando chama alguém', () => {
    it.each([
      ['Oi Água, tudo bem?', 'Oi Aqua, tudo bem?'],
      ['Obrigado, Água.', 'Obrigado, Aqua.'],
      ['Valeu água!', 'Valeu Aqua!'],
      ['Olá Água, bom dia!', 'Olá Aqua, bom dia!'],
      ['Bom dia, Água.', 'Bom dia, Aqua.'],
      ['Água, me conta uma ideia nova.', 'Aqua, me conta uma ideia nova.'],
      ['Água me conta uma ideia nova.', 'Aqua me conta uma ideia nova.'],
      ['Troca pra água.', 'Troca pra Aqua.'],
      ['Troca para a água.', 'Troca para a Aqua.'],
      ['Quero falar com a água.', 'Quero falar com a Aqua.'],
      ['Chama a água.', 'Chama a Aqua.'],
      ['Oi, Leu, tudo bem?', 'Oi, Leo, tudo bem?'],
      ['Troca pro Pix.', 'Troca pro Pixi.'],
      ['Pix, me conta uma história.', 'Pixi, me conta uma história.'],
    ])('%s', (heard, expected) => {
      expect(fix(heard)).toBe(expected);
    });

    it.each([
      'Quero beber água.',
      'Me traz um copo de água, por favor.',
      'A água do mar está gelada.',
      'Água com gás ou sem gás?',
      'Água, por favor.',
      'Água.',
      'Ei Corni, me lembra de beber água.',
      'Vamos falar de água e energia.',
      'Lavei com água quente.',
      'Eu gosto da Água.',
      'Vou pagar com o Pix.',
      'Passa o pix pra mim.',
      'Me manda um Pix agora.',
      'Ele leu o livro todo.',
      'Leu a mensagem?',
    ])('%s', (heard) => {
      expect(fix(heard)).toBe(heard);
    });
  });

  it('frase sem nenhum nome fica igual', () => {
    for (const t of ['Vou pagar com pix.', 'Que dia lindo hoje.', '', '...']) {
      expect(fix(t)).toBe(t);
    }
  });
});

describe('nameEntries', () => {
  it('põe o nome do app e aceita persona sem heardAs', () => {
    expect(nameEntries([{ name: 'Ari' }])).toEqual([STELLA_NAME, { name: 'Ari', heardAs: [] }]);
  });
});

describe('foldName', () => {
  it('tira acentos e maiúsculas', () => {
    expect(foldName('Água Léo CÓRNI')).toBe('agua leo corni');
  });
});

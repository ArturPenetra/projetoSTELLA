import { describe, expect, it } from 'vitest';
import { MouthTracker } from './mouth.js';

describe('MouthTracker', () => {
  it('abre acima do limite e fecha só abaixo do limite menor (histerese)', () => {
    const m = new MouthTracker({ openAt: 0.15, closeAt: 0.08 });
    expect(m.update(0.1, 0)).toBe(false); // entre os limites, fechada continua fechada
    expect(m.update(0.2, 33)).toBe(true);
    expect(m.update(0.1, 66)).toBe(true); // entre os limites, aberta continua aberta
    expect(m.update(0.05, 99)).toBe(false);
    expect(m.update(0.15, 132)).toBe(false); // igual ao limite não abre
  });

  it('volume 0 fecha na hora', () => {
    const m = new MouthTracker();
    m.update(0.9, 0);
    expect(m.update(0, 10)).toBe(false);
  });

  it('fica ativo enquanto chegam volumes e expira depois do tempo', () => {
    const m = new MouthTracker({ timeoutMs: 300 });
    expect(m.isActive(0)).toBe(false);
    m.update(0.5, 1000);
    expect(m.isActive(1299)).toBe(true);
    expect(m.isActive(1300)).toBe(false);
    // Depois de expirar, recomeça fechada.
    expect(m.update(0.1, 2000)).toBe(false);
  });

  it('valor inválido conta como silêncio', () => {
    const m = new MouthTracker();
    m.update(1, 0);
    expect(m.update(Number.NaN, 10)).toBe(false);
  });

  it('recusa limites invertidos', () => {
    expect(() => new MouthTracker({ openAt: 0.1, closeAt: 0.2 })).toThrow();
  });
});

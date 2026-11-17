import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_PROFILE, ProfileStore } from './profile.js';

describe('ProfileStore', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'stella-profile-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('sem arquivo, o onboarding ainda não foi feito', async () => {
    expect(await new ProfileStore(dir).load()).toEqual(DEFAULT_PROFILE);
  });

  it('salva e lê as escolhas', async () => {
    const store = new ProfileStore(dir);
    const profile = {
      onboarded: true,
      personaId: 'pixi',
      sign: 'pisces' as const,
      preference: 'similar' as const,
    };
    await store.save(profile);
    expect(await store.load()).toEqual(profile);
    expect(await readFile(store.path, 'utf8')).not.toMatch(/birth|nascimento|day|month/);
  });

  it('ignora arquivo inválido', async () => {
    const store = new ProfileStore(dir);
    await writeFile(store.path, '{"sign":"ofiúco"}');
    expect(await store.load()).toEqual(DEFAULT_PROFILE);
  });
});

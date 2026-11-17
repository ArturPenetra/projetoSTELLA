import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { PREFERENCES, SIGNS } from '@stella/core';
import { z } from 'zod';

/**
 * Escolhas do usuário sobre as personas. A data de nascimento nunca é guardada:
 * só o signo calculado (ou nenhum, se ele preferiu não dizer).
 */
const profileSchema = z.object({
  onboarded: z.boolean().default(false),
  personaId: z.string().optional(),
  sign: z.enum(SIGNS).nullable().default(null),
  preference: z.enum(PREFERENCES).nullable().default(null),
});
export type Profile = z.infer<typeof profileSchema>;

export const DEFAULT_PROFILE: Profile = { onboarded: false, sign: null, preference: null };

export class ProfileStore {
  readonly path: string;

  constructor(userDataDir: string) {
    this.path = join(userDataDir, 'profile.json');
  }

  async load(): Promise<Profile> {
    try {
      const parsed = profileSchema.safeParse(JSON.parse(await readFile(this.path, 'utf8')));
      if (parsed.success) return parsed.data;
    } catch {
      // Ausente ou corrompido: começa do zero (o onboarding aparece de novo).
    }
    return { ...DEFAULT_PROFILE };
  }

  async save(profile: Profile): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(
      this.path,
      JSON.stringify(profileSchema.parse(profile), null, 2) + '\n',
      'utf8',
    );
  }
}

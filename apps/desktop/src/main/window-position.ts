import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';

export interface Point {
  x: number;
  y: number;
}
export interface Size {
  width: number;
  height: number;
}
export type Rect = Point & Size;

/** Distância da borda da tela na posição padrão. */
const MARGIN = 24;
/** Parte mínima da janela que precisa ficar visível depois de ajustar a posição. */
const MIN_VISIBLE = 80;

/** Canto inferior direito da área de trabalho (acima da barra de tarefas). */
export function defaultPosition(workArea: Rect, size: Size): Point {
  return {
    x: Math.round(workArea.x + workArea.width - size.width - MARGIN),
    y: Math.round(workArea.y + workArea.height - size.height),
  };
}

function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

function distance(a: Rect, b: Rect): number {
  const dx = Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width), 0);
  const dy = Math.max(b.y - (a.y + a.height), a.y - (b.y + b.height), 0);
  return Math.hypot(dx, dy);
}

/**
 * Garante que a janela continue alcançável: se a posição salva caiu fora das telas
 * (monitor desligado, resolução trocada), traz a janela para a tela mais próxima.
 */
export function clampToScreens(pos: Point, size: Size, workAreas: Rect[]): Point {
  const first = workAreas[0];
  if (!first) return pos;
  const win: Rect = { ...pos, ...size };
  // Tela com maior área em comum; se a janela não toca nenhuma, a mais próxima.
  const score = (area: Rect) => overlap(win, area) || -distance(win, area);
  const best = workAreas.reduce((a, b) => (score(b) > score(a) ? b : a), first);
  const minX = best.x - size.width + MIN_VISIBLE;
  const maxX = best.x + best.width - MIN_VISIBLE;
  const minY = best.y;
  const maxY = best.y + best.height - MIN_VISIBLE;
  return {
    x: Math.round(Math.min(Math.max(pos.x, minX), maxX)),
    y: Math.round(Math.min(Math.max(pos.y, minY), maxY)),
  };
}

const stateSchema = z.object({
  x: z.number().int().optional(),
  y: z.number().int().optional(),
  visible: z.boolean().default(true),
});
export type CompanionState = z.infer<typeof stateSchema>;

/** Posição e visibilidade da companheira, salvas em companion.json na pasta de dados. */
export class CompanionStateStore {
  readonly path: string;

  constructor(userDataDir: string) {
    this.path = join(userDataDir, 'companion.json');
  }

  async load(): Promise<CompanionState> {
    try {
      const parsed = stateSchema.safeParse(JSON.parse(await readFile(this.path, 'utf8')));
      if (parsed.success) return parsed.data;
    } catch {
      // Arquivo ausente ou corrompido: usa os padrões.
    }
    return { visible: true };
  }

  async save(state: CompanionState): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify(state, null, 2) + '\n', 'utf8');
  }
}

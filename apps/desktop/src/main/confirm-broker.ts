import { randomUUID } from 'node:crypto';
import type { ConfirmRequest } from '@stella/core';
import type { ConfirmPrompt } from '../shared/ipc.js';

/** Sem resposta neste tempo, a ação é recusada. */
export const CONFIRM_TIMEOUT_MS = 60_000;

/**
 * Leva o pedido de confirmação até a janela de chat e espera a resposta do usuário.
 * Qualquer coisa que não seja um "permitir" explícito (tempo esgotado, Esc, resposta
 * cancelada, janela fechada) conta como "não". Não depende do Electron.
 */
export class ConfirmBroker {
  private pending = new Map<string, (allow: boolean) => void>();

  constructor(
    private readonly show: (prompt: ConfirmPrompt) => void,
    private readonly dismiss: (id: string) => void,
    private readonly timeoutMs = CONFIRM_TIMEOUT_MS,
  ) {}

  ask(request: ConfirmRequest, persona: string, signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted) return Promise.resolve(false);
    const id = randomUUID();
    return new Promise((resolvePromise) => {
      const done = (allow: boolean) => {
        if (!this.pending.delete(id)) return;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        if (!allow) this.dismiss(id);
        resolvePromise(allow);
      };
      const onAbort = () => done(false);
      const timer = setTimeout(() => done(false), this.timeoutMs);
      signal?.addEventListener('abort', onAbort);
      this.pending.set(id, done);
      this.show({
        id,
        persona,
        action: request.action,
        warning: request.afterUntrusted
          ? 'Este pedido apareceu depois de ler um arquivo. Arquivos podem conter instruções escondidas: se você não pediu isso, não permita.'
          : undefined,
        timeoutMs: this.timeoutMs,
      });
    });
  }

  /** Resposta da janela de chat. Ids desconhecidos (ou já respondidos) são ignorados. */
  answer(id: unknown, allow: unknown): void {
    if (typeof id !== 'string') return;
    this.pending.get(id)?.(allow === true);
  }

  /** Recusa tudo o que estiver esperando (por exemplo, ao fechar o app). */
  denyAll(): void {
    for (const done of [...this.pending.values()]) done(false);
  }
}

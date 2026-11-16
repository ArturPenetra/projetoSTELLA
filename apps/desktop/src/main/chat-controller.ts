import { randomUUID } from 'node:crypto';
import { ChatSession, LlmError, type LlmClient } from '@stella/core';
import { MAX_MESSAGE_LENGTH, type ChatEvent } from '../shared/ipc.js';

/**
 * Liga a sessão de chat aos eventos enviados ao renderer.
 * Não depende do Electron, para ser testado sozinho.
 */
export class ChatController {
  private session: ChatSession;
  private current: { id: string; abort: AbortController } | undefined;

  constructor(
    private readonly llm: LlmClient,
    private readonly emit: (event: ChatEvent) => void,
  ) {
    this.session = new ChatSession(llm);
  }

  send(text: unknown): { requestId: string } {
    if (typeof text !== 'string' || !text.trim()) {
      throw new Error('Mensagem vazia.');
    }
    if (text.length > MAX_MESSAGE_LENGTH) {
      throw new Error(`Mensagem longa demais (máximo ${MAX_MESSAGE_LENGTH} caracteres).`);
    }
    if (this.current) {
      throw new Error('Espere a resposta atual terminar ou cancele-a.');
    }

    const requestId = randomUUID();
    const abort = new AbortController();
    this.current = { id: requestId, abort };
    void this.run(requestId, text, abort.signal);
    return { requestId };
  }

  cancel(requestId: unknown): void {
    if (this.current && this.current.id === requestId) this.current.abort.abort();
  }

  reset(): void {
    this.current?.abort.abort();
    this.session = new ChatSession(this.llm);
  }

  /** Espera a resposta em andamento terminar (usado nos testes e ao fechar o app). */
  async idle(): Promise<void> {
    while (this.current) await new Promise((r) => setTimeout(r, 5));
  }

  private async run(requestId: string, text: string, signal: AbortSignal): Promise<void> {
    try {
      for await (const chunk of this.session.send(text, signal)) {
        if (chunk.type === 'token') {
          this.emit({ requestId, type: 'token', text: chunk.text });
        } else {
          this.emit({ requestId, type: 'done', ...chunk.stats });
        }
      }
    } catch (err) {
      if (err instanceof LlmError) {
        this.emit({ requestId, type: 'error', code: err.code, message: err.message });
      } else {
        console.error('[chat] erro inesperado', err);
        this.emit({
          requestId,
          type: 'error',
          code: 'internal',
          message: 'Algo deu errado ao gerar a resposta.',
        });
      }
    } finally {
      if (this.current?.id === requestId) this.current = undefined;
    }
  }
}

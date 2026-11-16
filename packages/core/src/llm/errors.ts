export type LlmErrorCode = 'unavailable' | 'model_missing' | 'aborted' | 'bad_response' | 'http';

/** Erro do modelo de linguagem, com mensagem pronta para mostrar ao usuário (pt-BR). */
export class LlmError extends Error {
  constructor(
    public readonly code: LlmErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'LlmError';
  }

  static unavailable(baseUrl: string, cause?: unknown): LlmError {
    return new LlmError(
      'unavailable',
      `Não consegui falar com o Ollama em ${baseUrl}. Confira se ele está aberto (ícone na bandeja) e tente de novo.`,
      { cause },
    );
  }

  static modelMissing(model: string): LlmError {
    return new LlmError(
      'model_missing',
      `O modelo "${model}" não está instalado. Rode "npm run models:pull" para baixá-lo.`,
    );
  }

  static aborted(): LlmError {
    return new LlmError('aborted', 'Resposta cancelada.');
  }
}

export function isAbortError(err: unknown): boolean {
  return (
    (err instanceof LlmError && err.code === 'aborted') ||
    (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError'))
  );
}

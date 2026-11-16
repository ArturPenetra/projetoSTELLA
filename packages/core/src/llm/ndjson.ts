/** Lê um stream de bytes com um JSON por linha (formato de streaming do Ollama). */
export async function* readNdjson(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) yield JSON.parse(line) as unknown;
      }
    }
    buffer += decoder.decode();
    const rest = buffer.trim();
    if (rest) yield JSON.parse(rest) as unknown;
  } finally {
    reader.releaseLock();
  }
}

/**
 * Política de rede da Stella: o app roda 100% local.
 * Durante o uso, só endereços de loopback (o próprio computador) são permitidos.
 */

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

/** Protocolos internos que não saem do computador (arquivos do app, devtools, dados embutidos). */
const LOCAL_PROTOCOLS = new Set([
  'file:',
  'data:',
  'blob:',
  'devtools:',
  'chrome:',
  'chrome-extension:',
]);

export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return LOOPBACK_HOSTS.has(host) || /^127(?:\.\d{1,3}){3}$/.test(host);
}

/** URL HTTP(S)/WS(S) apontando para o próprio computador. */
export function isLoopbackUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(parsed.protocol)) return false;
  return isLoopbackHost(parsed.hostname);
}

/** Uma requisição feita pelo app é permitida? (loopback ou protocolo interno) */
export function isRequestAllowed(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (LOCAL_PROTOCOLS.has(parsed.protocol)) return true;
  return isLoopbackUrl(url);
}

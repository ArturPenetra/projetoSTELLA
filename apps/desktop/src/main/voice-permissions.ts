/**
 * Regra do microfone, sem Electron (testada sozinha): só a janela de áudio, carregada
 * do próprio app, ganha a permissão 'media', e só para áudio (nunca câmera).
 */
export interface MediaPermissionQuery {
  permission: string;
  /** O pedido veio do webContents da janela de áudio? */
  fromVoiceWindow: boolean;
  /** `details.mediaTypes` do Electron (ex.: ['audio']). */
  mediaTypes: readonly string[] | undefined;
  /** `details.requestingUrl` (ou `securityOrigin`) do pedido. */
  requestingUrl: string | undefined;
  /** ELECTRON_RENDERER_URL em desenvolvimento; undefined no app empacotado. */
  devUrl: string | undefined;
}

export function isTrustedAppUrl(url: string | undefined, devUrl: string | undefined): boolean {
  if (!url) return false;
  return (
    url.startsWith('file://') || (devUrl !== undefined && devUrl !== '' && url.startsWith(devUrl))
  );
}

export function isMicPermissionAllowed(q: MediaPermissionQuery): boolean {
  if (q.permission !== 'media' || !q.fromVoiceWindow) return false;
  const types = q.mediaTypes ?? [];
  if (types.length === 0 || !types.every((t) => t === 'audio')) return false;
  return isTrustedAppUrl(q.requestingUrl, q.devUrl);
}

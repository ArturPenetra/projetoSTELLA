import { app, BrowserWindow, type Session, type WebContents } from 'electron';
import { isMicPermissionAllowed } from './voice-permissions.js';
import { load, secureWebPreferences } from './windows.js';

const devUrl = !app.isPackaged ? process.env['ELECTRON_RENDERER_URL'] : undefined;

/**
 * Janela de áudio: nunca aparece. Abre o microfone e toca as falas (voice.html).
 * Criada só quando a voz está ligada e destruída ao desligar.
 * `backgroundThrottling: false` mantém timers e áudio em ritmo normal mesmo oculta, e o
 * autoplay liberado deixa o AudioContext tocar sem um clique na janela (que não tem tela).
 */
export function createVoiceWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 200,
    height: 100,
    show: false,
    skipTaskbar: true,
    focusable: false,
    webPreferences: {
      ...secureWebPreferences('voice'),
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
      spellcheck: false,
    },
  });
  load(win, 'voice');
  return win;
}

type PermissionRequestHandler = Parameters<Session['setPermissionRequestHandler']>[0];
type RequestHandler = NonNullable<PermissionRequestHandler>;

/** O comportamento de hoje (index.ts): nenhuma permissão do navegador é concedida. */
const denyAll: RequestHandler = (_wc, _permission, callback) => callback(false);

/**
 * Libera o microfone (só áudio) para a janela de áudio. Qualquer outro pedido, de
 * qualquer janela, vai para `fallback` (por padrão nega tudo, como index.ts já faz).
 * Ao fechar a janela, volta só o `fallback`. Devolve uma função que desfaz na hora.
 *
 * O Electron guarda um único handler por sessão e não deixa ler o atual, então quem
 * já tinha instalado um handler próprio deve passá-lo como `fallback`.
 */
export function allowMicFor(win: BrowserWindow, fallback: RequestHandler = denyAll): () => void {
  const session = win.webContents.session;
  const voiceId = win.webContents.id;
  const fromVoice = (wc: WebContents | null) =>
    !win.isDestroyed() && wc !== null && wc.id === voiceId;

  session.setPermissionRequestHandler((wc, permission, callback, details) => {
    if (permission === 'media' && fromVoice(wc)) {
      const media = details as Electron.MediaAccessPermissionRequest;
      const allowed = isMicPermissionAllowed({
        permission,
        fromVoiceWindow: true,
        mediaTypes: media.mediaTypes,
        requestingUrl: media.requestingUrl || media.securityOrigin,
        devUrl,
      });
      if (!allowed) console.warn('[voz] pedido de mídia negado (só o microfone é liberado)');
      callback(allowed);
      return;
    }
    fallback(wc, permission, callback, details);
  });

  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    session.setPermissionRequestHandler(fallback);
  };
  win.once('closed', restore);
  return restore;
}

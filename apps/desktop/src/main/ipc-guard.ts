import type { BrowserWindow, IpcMainEvent, IpcMainInvokeEvent } from 'electron';

/**
 * Só a página do próprio app, carregada na janela certa, pode chamar cada canal.
 * Assim a janela do avatar não usa o chat e vice-versa.
 */
export function assertSender(event: IpcMainEvent | IpcMainInvokeEvent, win: BrowserWindow): void {
  if (win.isDestroyed() || event.sender.id !== win.webContents.id) {
    throw new Error('Chamada IPC de origem desconhecida.');
  }
  const url = event.senderFrame?.url ?? '';
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  const trusted = url.startsWith('file://') || (devUrl !== undefined && url.startsWith(devUrl));
  if (!trusted) throw new Error('Chamada IPC de origem desconhecida.');
}

/** Para canais sem resposta (`ipcMain.on`): ignora em silêncio em vez de lançar. */
export function isFromWindow(event: IpcMainEvent, win: BrowserWindow): boolean {
  try {
    assertSender(event, win);
    return true;
  } catch {
    console.warn('[ipc] mensagem ignorada: origem desconhecida');
    return false;
  }
}

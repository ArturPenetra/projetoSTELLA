import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import type { LlmClient } from '@stella/core';
import { IPC, type ChatEvent } from '../shared/ipc.js';
import { ChatController } from './chat-controller.js';

/** Só a página do próprio app pode chamar o processo principal. */
function assertTrustedSender(event: IpcMainInvokeEvent, win: BrowserWindow): void {
  if (event.sender.id !== win.webContents.id) {
    throw new Error('Chamada IPC de origem desconhecida.');
  }
  const url = event.senderFrame?.url ?? '';
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  const trusted = url.startsWith('file://') || (devUrl !== undefined && url.startsWith(devUrl));
  if (!trusted) throw new Error('Chamada IPC de origem desconhecida.');
}

export function registerIpc(win: BrowserWindow, llm: LlmClient): ChatController {
  const emit = (event: ChatEvent) => {
    if (!win.isDestroyed()) win.webContents.send(IPC.chatEvent, event);
  };
  const chat = new ChatController(llm, emit);

  ipcMain.handle(IPC.llmStatus, (event) => {
    assertTrustedSender(event, win);
    return llm.status();
  });
  ipcMain.handle(IPC.chatSend, (event, text: unknown) => {
    assertTrustedSender(event, win);
    return chat.send(text);
  });
  ipcMain.handle(IPC.chatCancel, (event, requestId: unknown) => {
    assertTrustedSender(event, win);
    chat.cancel(requestId);
  });
  ipcMain.handle(IPC.chatReset, (event) => {
    assertTrustedSender(event, win);
    chat.reset();
  });

  return chat;
}

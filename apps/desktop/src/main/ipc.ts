import { ipcMain, type BrowserWindow } from 'electron';
import type { AvatarDirector, LlmClient } from '@stella/core';
import { IPC, type ChatEvent } from '../shared/ipc.js';
import { ChatController, type ChatControllerOptions } from './chat-controller.js';
import { assertSender } from './ipc-guard.js';

/** Repassa cada evento do chat ao avatar, que decide o próprio estado. */
export function feedAvatar(director: AvatarDirector, event: ChatEvent): void {
  switch (event.type) {
    case 'start':
      director.userSent();
      break;
    case 'token':
      director.token(event.text);
      break;
    case 'done':
      director.done();
      break;
    case 'error':
      if (event.code === 'aborted') director.cancelled();
      else director.failed(event.message);
      break;
  }
}

export function registerChatIpc(
  win: BrowserWindow,
  llm: LlmClient,
  director: AvatarDirector,
  options: ChatControllerOptions = {},
): ChatController {
  const emit = (event: ChatEvent) => {
    if (!win.isDestroyed()) win.webContents.send(IPC.chatEvent, event);
    feedAvatar(director, event);
  };
  const chat = new ChatController(llm, emit, options);

  ipcMain.handle(IPC.llmStatus, (event) => {
    assertSender(event, win);
    return llm.status();
  });
  ipcMain.handle(IPC.chatSend, (event, text: unknown) => {
    assertSender(event, win);
    return chat.send(text);
  });
  ipcMain.handle(IPC.chatCancel, (event, requestId: unknown) => {
    assertSender(event, win);
    chat.cancel(requestId);
  });
  ipcMain.handle(IPC.chatReset, (event) => {
    assertSender(event, win);
    chat.reset();
    director.cancelled();
  });

  return chat;
}

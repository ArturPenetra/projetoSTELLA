import { ipcMain, type BrowserWindow } from 'electron';
import { IPC, type SpeakerView } from '../shared/ipc.js';
import { assertSender } from './ipc-guard.js';
import type { PersonaService } from './persona-service.js';

/** Canais de personas e onboarding (janela de chat) e o nome/cor da persona (avatar). */
export function registerPersonaIpc(
  chat: BrowserWindow,
  companion: BrowserWindow,
  personas: PersonaService,
): void {
  ipcMain.handle(IPC.personaState, (event) => {
    assertSender(event, chat);
    return personas.state();
  });
  ipcMain.handle(IPC.personaSelect, (event, id: unknown) => {
    assertSender(event, chat);
    return personas.select(id);
  });
  ipcMain.handle(IPC.personaSuggest, (event, sign: unknown, preference: unknown) => {
    assertSender(event, chat);
    return personas.suggest(sign, preference);
  });
  ipcMain.handle(IPC.personaSignsForDate, (event, day: unknown, month: unknown) => {
    assertSender(event, chat);
    return personas.signsForDate(day, month);
  });
  ipcMain.handle(IPC.personaFinishOnboarding, (event, choice: unknown) => {
    assertSender(event, chat);
    return personas.finishOnboarding(choice);
  });

  const speakerView = (): SpeakerView => ({
    id: personas.current.id,
    name: personas.current.name,
    element: personas.current.element,
  });
  ipcMain.handle(IPC.companionPersonaGet, (event) => {
    assertSender(event, companion);
    return speakerView();
  });

  personas.onChanged((view) => {
    if (!chat.isDestroyed()) chat.webContents.send(IPC.personaChanged, view);
    if (!companion.isDestroyed()) companion.webContents.send(IPC.companionPersona, speakerView());
  });
}

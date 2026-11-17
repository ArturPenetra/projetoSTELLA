import { ipcMain, type BrowserWindow } from 'electron';
import type { Fact, Memory } from '@stella/core';
import { IPC, MAX_FACT_LENGTH, type FactView, type MemoryStatus } from '../shared/ipc.js';
import { assertSender } from './ipc-guard.js';

export function toFactView(f: Fact): FactView {
  return {
    id: f.id,
    text: f.text,
    sensitive: f.sensitive,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
  };
}

function factId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new Error('Fato inválido.');
  }
  return value;
}

/**
 * Canais da tela de memória. Só a janela de chat usa. Sem memória (desligada ou com erro
 * ao abrir), a tela mostra o motivo e as ações recusam.
 */
export function registerMemoryIpc(
  win: BrowserWindow,
  memory: Memory | undefined,
  disabledReason: string,
): void {
  const active = (): Memory => {
    if (!memory) throw new Error(disabledReason);
    return memory;
  };

  ipcMain.handle(IPC.memoryStatus, (event): MemoryStatus => {
    assertSender(event, win);
    return memory
      ? { enabled: true, factCount: memory.store.factCount() }
      : { enabled: false, reason: disabledReason };
  });

  ipcMain.handle(IPC.memoryList, (event): FactView[] => {
    assertSender(event, win);
    return memory ? memory.listFacts().map(toFactView) : [];
  });

  ipcMain.handle(IPC.memoryUpdate, async (event, id: unknown, text: unknown) => {
    assertSender(event, win);
    if (typeof text !== 'string' || !text.trim()) throw new Error('O fato não pode ficar vazio.');
    if (text.length > MAX_FACT_LENGTH) {
      throw new Error(`Fato longo demais (máximo ${MAX_FACT_LENGTH} caracteres).`);
    }
    const fact = await active().updateFact(factId(id), text);
    if (!fact) throw new Error('Esse fato não existe mais.');
    return toFactView(fact);
  });

  ipcMain.handle(IPC.memoryDelete, (event, id: unknown) => {
    assertSender(event, win);
    active().deleteFact(factId(id));
  });

  ipcMain.handle(IPC.memoryClear, (event, options: unknown) => {
    assertSender(event, win);
    const history =
      typeof options === 'object' && options !== null && 'history' in options
        ? options.history === true
        : false;
    active().clear({ history });
  });
}

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfirmPrompt } from '../shared/ipc.js';
import { ConfirmBroker } from './confirm-broker.js';
import { suggestedApps, ToolLog, ToolSettingsStore } from './tools-store.js';

const request = {
  tool: 'open_app' as const,
  action: 'Abrir o aplicativo Calculadora',
  afterUntrusted: false,
};

describe('ConfirmBroker', () => {
  let shown: ConfirmPrompt[];
  let dismissed: string[];
  let broker: ConfirmBroker;

  beforeEach(() => {
    vi.useFakeTimers();
    shown = [];
    dismissed = [];
    broker = new ConfirmBroker(
      (p) => shown.push(p),
      (id) => dismissed.push(id),
      1000,
    );
  });
  afterEach(() => vi.useRealTimers());

  it('mostra a ação por extenso e devolve a resposta do usuário', async () => {
    const answer = broker.ask(request, 'Pixi');
    expect(shown).toEqual([
      {
        id: expect.any(String),
        persona: 'Pixi',
        action: 'Abrir o aplicativo Calculadora',
        warning: undefined,
        timeoutMs: 1000,
      },
    ]);
    broker.answer(shown[0]?.id, true);
    await expect(answer).resolves.toBe(true);
  });

  it('avisa quando o pedido veio depois de ler um arquivo', () => {
    void broker.ask({ ...request, afterUntrusted: true }, 'Pixi');
    expect(shown[0]?.warning).toMatch(/depois de ler um arquivo/);
  });

  it('sem resposta no tempo, é "não" e o diálogo some', async () => {
    const answer = broker.ask(request, 'Pixi');
    vi.advanceTimersByTime(1000);
    await expect(answer).resolves.toBe(false);
    expect(dismissed).toEqual([shown[0]?.id]);
  });

  it('Esc (cancelar a resposta) é "não"', async () => {
    const abort = new AbortController();
    const answer = broker.ask(request, 'Pixi', abort.signal);
    abort.abort();
    await expect(answer).resolves.toBe(false);
  });

  it('só um "true" explícito permite; ids falsos e respostas repetidas são ignorados', async () => {
    const answer = broker.ask(request, 'Pixi');
    broker.answer('id-inventado', true);
    broker.answer(shown[0]?.id, 'sim');
    await expect(answer).resolves.toBe(false);
    broker.answer(shown[0]?.id, true); // já respondido: nada muda
  });

  it('fechar o app recusa tudo o que está esperando', async () => {
    const a = broker.ask(request, 'Pixi');
    const b = broker.ask(request, 'Leo');
    broker.denyAll();
    await expect(Promise.all([a, b])).resolves.toEqual([false, false]);
  });
});

describe('ToolSettingsStore e ToolLog', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'stella-tools-store-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('primeira vez: tudo desligado, sem pastas, com os apps do Windows sugeridos', async () => {
    const store = new ToolSettingsStore(dir);
    const settings = await store.load();
    expect(settings.enabled).toEqual({ open_app: false, read_file: false });
    expect(settings.folders).toEqual([]);
    expect(settings.apps).toEqual(suggestedApps());
    expect(JSON.parse(await readFile(store.path, 'utf8'))).toEqual(settings);
  });

  it('arquivo inválido: volta tudo desligado', async () => {
    const store = new ToolSettingsStore(dir);
    await writeFile(store.path, '{"enabled":{"open_app":"sim"}}');
    expect((await store.load()).enabled).toEqual({ open_app: false, read_file: false });
  });

  it('o log guarda cada ação e mostra as mais novas primeiro', async () => {
    const log = new ToolLog(dir);
    log.append({
      at: 1,
      tool: 'read_file',
      action: 'Ler a.txt',
      decision: 'executado',
      detail: 'Li a.txt',
    });
    log.append({
      at: 2,
      tool: 'open_app',
      action: 'Abrir Chrome',
      decision: 'bloqueado',
      detail: 'fora da lista',
    });
    await vi.waitFor(async () => expect(await log.recent()).toHaveLength(2));
    expect((await log.recent()).map((e) => e.at)).toEqual([2, 1]);
  });
});

import type { FactView, StellaApi } from '../shared/ipc.js';

function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Elemento #${id} não encontrado`);
  return el as T;
}

/** Mensagem de erro do IPC sem o prefixo técnico do Electron. */
export function cleanIpcError(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
}

const dateFormat = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

/**
 * Tela "O que fica na memória": ver, editar e esquecer fatos. Vale para todas as personas.
 * Todos os textos entram com textContent (nunca como HTML): fatos vêm da conversa.
 */
export function setupMemoryPanel(stella: StellaApi, openButton: HTMLButtonElement) {
  const panel = $<HTMLElement>('memory-panel');
  const list = $<HTMLUListElement>('memory-list');
  const status = $<HTMLElement>('memory-status');
  const empty = $<HTMLElement>('memory-empty');
  const closeButton = $<HTMLButtonElement>('memory-close');
  const clearButton = $<HTMLButtonElement>('memory-clear');
  const clearHistory = $<HTMLInputElement>('memory-clear-history');

  let confirmTimer: ReturnType<typeof setTimeout> | undefined;

  function setStatus(text: string, kind: 'info' | 'error' = 'info'): void {
    status.textContent = text;
    status.dataset['kind'] = kind;
  }

  function renderFact(fact: FactView): HTMLLIElement {
    const item = document.createElement('li');
    item.className = 'fact';
    item.dataset['id'] = String(fact.id);

    const text = document.createElement('p');
    text.className = 'fact-text';
    text.textContent = fact.text;

    const meta = document.createElement('p');
    meta.className = 'fact-meta';
    meta.textContent = `Guardado em ${dateFormat.format(fact.createdAt)}${
      fact.sensitive ? ' · assunto delicado: só comento se você puxar' : ''
    }`;

    const actions = document.createElement('div');
    actions.className = 'fact-actions';
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'ghost small';
    edit.textContent = 'Editar';
    edit.addEventListener('click', () => startEdit(item, fact));
    const forget = document.createElement('button');
    forget.type = 'button';
    forget.className = 'ghost small forget';
    forget.textContent = 'Esquecer';
    forget.setAttribute('aria-label', `Esquecer: ${fact.text}`);
    forget.addEventListener('click', () => void forgetFact(fact.id));
    actions.append(edit, forget);

    item.append(text, meta, actions);
    return item;
  }

  function startEdit(item: HTMLLIElement, fact: FactView): void {
    const input = document.createElement('textarea');
    input.className = 'fact-input';
    input.value = fact.text;
    input.maxLength = 300;
    input.rows = 2;
    input.setAttribute('aria-label', 'Texto do fato');

    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'small';
    save.textContent = 'Salvar';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'ghost small';
    cancel.textContent = 'Cancelar';

    const actions = document.createElement('div');
    actions.className = 'fact-actions';
    actions.append(save, cancel);
    item.replaceChildren(input, actions);
    input.focus();

    const doSave = async () => {
      save.disabled = true;
      try {
        const updated = await stella.memory.update(fact.id, input.value);
        item.replaceWith(renderFact(updated));
        setStatus('Fato atualizado.');
      } catch (err) {
        save.disabled = false;
        setStatus(cleanIpcError(err), 'error');
      }
    };
    save.addEventListener('click', () => void doSave());
    cancel.addEventListener('click', () => item.replaceWith(renderFact(fact)));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void doSave();
      } else if (e.key === 'Escape') {
        e.stopPropagation();
        item.replaceWith(renderFact(fact));
      }
    });
  }

  async function forgetFact(id: number): Promise<void> {
    try {
      await stella.memory.delete(id);
      list.querySelector(`[data-id="${id}"]`)?.remove();
      empty.hidden = list.children.length > 0;
      setStatus('Pronto, esqueci.');
    } catch (err) {
      setStatus(cleanIpcError(err), 'error');
    }
  }

  async function refresh(): Promise<void> {
    const state = await stella.memory.status();
    const enabled = state.enabled;
    clearButton.disabled = !enabled;
    clearHistory.disabled = !enabled;
    if (!enabled) {
      list.replaceChildren();
      empty.hidden = true;
      setStatus(state.reason, 'error');
      return;
    }
    const facts = await stella.memory.list();
    list.replaceChildren(...facts.map(renderFact));
    empty.hidden = facts.length > 0;
    setStatus(
      facts.length === 1
        ? '1 coisa guardada sobre você.'
        : `${facts.length} coisas guardadas sobre você.`,
    );
  }

  function resetClearButton(): void {
    clearTimeout(confirmTimer);
    confirmTimer = undefined;
    clearButton.textContent = 'Esquecer tudo';
    clearButton.classList.remove('confirm');
  }

  // Duas etapas: o primeiro clique pede confirmação com a ação escrita por extenso.
  clearButton.addEventListener('click', () => {
    if (!confirmTimer) {
      clearButton.textContent = clearHistory.checked
        ? 'Confirmar: apagar fatos e conversas'
        : 'Confirmar: apagar todos os fatos';
      clearButton.classList.add('confirm');
      confirmTimer = setTimeout(resetClearButton, 5000);
      return;
    }
    resetClearButton();
    void stella.memory
      .clear({ history: clearHistory.checked })
      .then(refresh)
      .then(() =>
        setStatus(clearHistory.checked ? 'Esqueci tudo, inclusive as conversas.' : 'Esqueci tudo.'),
      )
      .catch((err: unknown) => setStatus(cleanIpcError(err), 'error'));
  });

  function open(): void {
    panel.hidden = false;
    openButton.setAttribute('aria-expanded', 'true');
    resetClearButton();
    void refresh().catch((err: unknown) => setStatus(cleanIpcError(err), 'error'));
    closeButton.focus();
  }

  function close(): void {
    panel.hidden = true;
    openButton.setAttribute('aria-expanded', 'false');
    openButton.focus();
  }

  openButton.addEventListener('click', open);
  closeButton.addEventListener('click', close);
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });

  // Fatos novos aparecem na hora se o painel estiver aberto.
  stella.memory.onEvent((event) => {
    if (event.type === 'added' && !panel.hidden) void refresh();
  });

  return { open, isOpen: () => !panel.hidden };
}

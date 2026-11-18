import type { ConfirmPrompt, StellaApi, ToolsState } from '../shared/ipc.js';
import { cleanIpcError } from './memory-panel.js';

function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Elemento #${id} não encontrado`);
  return el as T;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function button(text: string, onClick: () => void, className = ''): HTMLButtonElement {
  const b = el('button', className, text);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

/** O que aparece enquanto a ferramenta roda (indicador "agindo"). */
export const TOOL_ACTIVITY: Record<string, string> = {
  read_file: 'Lendo um arquivo…',
  open_app: 'Abrindo um aplicativo…',
};

const TOOL_TITLES: Record<'read_file' | 'open_app', [string, string]> = {
  read_file: [
    'Ler arquivos',
    'Ler arquivos de texto das pastas que você escolher. Nada fora delas, nunca os arquivos do próprio app.',
  ],
  open_app: [
    'Abrir aplicativos',
    'Abrir só os programas da lista. Sempre pede sua confirmação antes.',
  ],
};

const timeFormat = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

/**
 * Tela de ferramentas e diálogo de confirmação. Caminhos de pastas e apps só entram pelo
 * diálogo do sistema (aberto no processo principal); daqui só vão pedidos.
 */
export function setupTools(stella: StellaApi, onEscape: () => void): void {
  const panel = $<HTMLElement>('tools-panel');
  const openButton = $<HTMLButtonElement>('tools-open');
  const confirm = $<HTMLElement>('confirm');
  let confirmId: string | undefined;
  let confirmTimer: ReturnType<typeof setInterval> | undefined;

  // --- Painel --------------------------------------------------------------------------

  function section(title: string, ...children: HTMLElement[]): HTMLElement {
    const s = el('section', 'tools-section');
    s.append(el('h3', '', title), ...children);
    return s;
  }

  function list(items: { label: string; detail?: string; remove: () => void }[], empty: string) {
    const ul = el('ul', 'tools-list');
    if (items.length === 0) ul.append(el('li', 'tools-empty', empty));
    for (const item of items) {
      const li = el('li');
      const text = el('div', 'tools-item');
      text.append(el('span', '', item.label));
      if (item.detail) text.append(el('small', '', item.detail));
      li.append(text, button('Remover', item.remove, 'ghost small'));
      ul.append(li);
    }
    return ul;
  }

  /**
   * "Adicionar do Menu Iniciar": lista os atalhos com busca. Abrir pelo atalho funciona
   * com apps que usam um iniciador (como o Discord) e com apps da Microsoft Store.
   */
  function startMenuPicker(add: (path: string) => void): HTMLElement {
    const box = el('div', 'start-menu');
    const open = button('Adicionar do Menu Iniciar…', () => void show(), '');
    open.id = 'start-menu-open';
    box.append(open);

    async function show(): Promise<void> {
      const entries = await stella.tools.startMenu();
      const search = el('input', 'start-menu-search');
      search.type = 'search';
      search.id = 'start-menu-search';
      search.placeholder = 'Buscar app…';
      search.setAttribute('aria-label', 'Buscar app no Menu Iniciar');
      const results = el('ul', 'start-menu-list');
      results.id = 'start-menu-list';
      const fill = () => {
        const term = search.value.trim().toLowerCase();
        const shown = entries.filter((e) => e.name.toLowerCase().includes(term)).slice(0, 50);
        results.replaceChildren(
          ...(shown.length
            ? shown.map((e) => {
                const li = el('li');
                li.append(button(e.name, () => add(e.path), 'ghost small start-menu-item'));
                return li;
              })
            : [el('li', 'tools-empty', 'Nenhum app encontrado.')]),
        );
      };
      search.addEventListener('input', fill);
      fill();
      box.replaceChildren(search, results);
      search.focus();
    }
    return box;
  }

  async function render(state?: ToolsState, error?: string): Promise<void> {
    const s = state ?? (await stella.tools.state());
    const status = el('p', 'overlay-status');
    status.id = 'tools-status';
    status.textContent =
      error ?? 'Tudo começa desligado. Ações sempre pedem sua confirmação, e Esc cancela na hora.';
    if (error) status.dataset['kind'] = 'error';

    const act = (p: Promise<ToolsState>) =>
      void p
        .then((next) => render(next))
        .catch((err: unknown) => render(undefined, cleanIpcError(err)));

    const toggles = el('div', 'tools-toggles');
    for (const tool of ['read_file', 'open_app'] as const) {
      const [title, detail] = TOOL_TITLES[tool];
      const label = el('label', 'tools-toggle');
      const input = el('input');
      input.type = 'checkbox';
      input.id = `tool-${tool}`;
      input.checked = s.enabled[tool];
      input.addEventListener('change', () => act(stella.tools.setEnabled(tool, input.checked)));
      const text = el('span');
      text.append(el('strong', '', title), el('small', '', detail));
      label.append(input, text);
      toggles.append(label);
    }

    const folders = section(
      'Pastas que podem ser lidas',
      list(
        s.folders.map((f) => ({ label: f, remove: () => act(stella.tools.removeFolder(f)) })),
        'Nenhuma pasta ainda.',
      ),
      button('Adicionar pasta…', () => act(stella.tools.addFolder()), 'ghost'),
    );
    const apps = section(
      'Aplicativos que podem ser abertos',
      list(
        s.apps.map((a) => ({
          label: a.name,
          detail: a.path,
          remove: () => act(stella.tools.removeApp(a.name)),
        })),
        'Nenhum aplicativo ainda.',
      ),
      startMenuPicker((path) => act(stella.tools.addStartMenuApp(path))),
      button('Adicionar programa (.exe)…', () => act(stella.tools.addApp()), 'ghost'),
    );

    const logList = el('ul', 'tools-log');
    logList.id = 'tools-log';
    const entries = await stella.tools.log();
    if (entries.length === 0) logList.append(el('li', 'tools-empty', 'Nenhuma ação ainda.'));
    for (const e of entries.slice(0, 20)) {
      const li = el('li');
      li.dataset['decision'] = e.decision;
      li.append(
        el('span', 'tools-log-when', timeFormat.format(e.at)),
        el('span', 'tools-log-what', e.action),
        el('span', 'tools-log-decision', `${e.decision}${e.detail ? ` · ${e.detail}` : ''}`),
      );
      logList.append(li);
    }

    const head = el('header', 'overlay-head');
    const h2 = el('h2', '', 'Ferramentas');
    h2.id = 'tools-title';
    head.append(h2, button('Fechar', close, 'ghost'));
    panel.replaceChildren(head, status, toggles, folders, apps, section('Últimas ações', logList));
  }

  function open(): void {
    panel.hidden = false;
    openButton.setAttribute('aria-expanded', 'true');
    void render().then(() => panel.querySelector<HTMLElement>('input, button')?.focus());
  }

  function close(): void {
    panel.hidden = true;
    openButton.setAttribute('aria-expanded', 'false');
    openButton.focus();
  }

  openButton.addEventListener('click', open);
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  });

  // --- Confirmação ---------------------------------------------------------------------

  function hideConfirm(): void {
    confirm.hidden = true;
    confirmId = undefined;
    clearInterval(confirmTimer);
  }

  function answer(allow: boolean): void {
    if (!confirmId) return;
    void stella.tools.reply(confirmId, allow);
    hideConfirm();
  }

  stella.tools.onConfirm((prompt: ConfirmPrompt) => {
    confirmId = prompt.id;
    $<HTMLElement>('confirm-title').textContent = `${prompt.persona} quer fazer isto:`;
    $<HTMLElement>('confirm-action').textContent = prompt.action;
    const warning = $<HTMLElement>('confirm-warning');
    warning.hidden = !prompt.warning;
    warning.textContent = prompt.warning ?? '';
    const hint = $<HTMLElement>('confirm-hint');
    let left = Math.round(prompt.timeoutMs / 1000);
    const tick = () => {
      hint.textContent = `Sem resposta em ${left} s, a ação é cancelada. Esc também cancela.`;
      left--;
    };
    tick();
    clearInterval(confirmTimer);
    confirmTimer = setInterval(tick, 1000);
    confirm.hidden = false;
    // Foco no "Não permitir": Enter sem pensar nunca autoriza nada.
    $<HTMLButtonElement>('confirm-deny').focus();
  });
  stella.tools.onConfirmDismiss((id) => {
    if (id === confirmId) hideConfirm();
  });
  $<HTMLButtonElement>('confirm-allow').addEventListener('click', () => answer(true));
  $<HTMLButtonElement>('confirm-deny').addEventListener('click', () => answer(false));

  // Botão de pânico: Esc recusa a confirmação aberta e cancela o que estiver em andamento.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !panel.hidden) return;
    if (confirmId) answer(false);
    onEscape();
  });
}

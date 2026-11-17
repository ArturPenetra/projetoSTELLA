import type { ElementId, Preference, SignId } from '@stella/core';
import avatarSvg from '../../../../assets/avatar/zodi-avatar.svg?raw';
import type { PersonaState, PersonaView, StellaApi, SuggestionView } from '../shared/ipc.js';
import { cleanIpcError } from './memory-panel.js';

function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Elemento #${id} não encontrado`);
  return el as T;
}

/** Cria um elemento com classe e texto (sempre textContent: nada vira HTML). */
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text = '',
): HTMLElementTagNameMap[K] {
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

/** Avatar pequeno na paleta do elemento, como imagem (estilos e ids isolados da página). */
export function miniAvatar(element: ElementId, size = 56): HTMLImageElement {
  const svg = avatarSvg.replace(/data-element="[^"]*"/, `data-element="${element}"`);
  const img = el('img', 'mini-avatar');
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  img.width = size;
  img.height = Math.round((size * 520) / 400);
  img.alt = '';
  return img;
}

const PREFERENCE_TEXT: Record<Preference, [title: string, detail: string]> = {
  similar: ['Mais parecida comigo', 'Alguém com o seu jeito de ser.'],
  compatible: ['Maior compatibilidade', 'Alguém que complementa você.'],
  contrast: ['Maior contraste', 'Alguém bem diferente, para te tirar da zona de conforto.'],
};

const MONTHS = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

const ela = (p: Pick<PersonaView, 'gender'>) => (p.gender === 'masculine' ? 'ele' : 'ela');

/** Só as cores (a sugestão do onboarding mostra a paleta de quem foi sugerida). */
function applyColors(p: PersonaView): void {
  const root = document.documentElement.style;
  // A cor profunda tem contraste ≥ 4,5:1 com texto branco nas 4 paletas.
  root.setProperty('--primary', p.palette.profunda);
  root.setProperty('--deep', p.palette.profunda);
  root.setProperty('--glow', p.palette.brilho);
  document.documentElement.dataset['element'] = p.element;
}

/** Aplica as cores e o nome da persona na janela de chat. */
function applyTheme(p: PersonaView): void {
  applyColors(p);
  $<HTMLElement>('persona-name').textContent = p.name;
  document.title = p.name;
}

export async function setupPersonas(stella: StellaApi): Promise<void> {
  const panel = $<HTMLElement>('persona-panel');
  const onboarding = $<HTMLElement>('onboarding');
  const openButton = $<HTMLButtonElement>('personas-open');
  let state: PersonaState = await stella.personas.state();

  const palettes = new Map(state.personas.map((p) => [p.element, p.palette]));
  // Cor do nome de quem respondeu, acima de cada fala.
  for (const [element, palette] of palettes) {
    document.documentElement.style.setProperty(`--speaker-${element}`, palette.brilho);
  }
  applyTheme(state.current);

  stella.personas.onChanged((p) => {
    applyTheme(p);
    void stella.personas.state().then((s) => {
      state = s;
      if (!panel.hidden) renderPanel();
    });
  });

  // --- Grade de personas (painel e fim do onboarding) ------------------------------------

  function personaGrid(onPick: (p: PersonaView) => void, markCurrent = true): HTMLElement {
    const grid = el('ul', 'persona-grid');
    for (const p of state.personas) {
      const item = el('li');
      const card = el('button', 'persona-card');
      card.type = 'button';
      card.dataset['id'] = p.id;
      card.dataset['element'] = p.element;
      const active = p.status === 'active';
      card.disabled = !active;
      if (markCurrent && p.id === state.current.id) card.setAttribute('aria-current', 'true');
      card.append(
        miniAvatar(p.element, 44),
        el('strong', 'persona-card-name', p.name),
        el('span', 'persona-card-role', active ? p.role : 'Em breve'),
      );
      card.title = active ? `${p.name}: ${p.coreTrait}` : `${p.name} chega em breve`;
      if (active) card.addEventListener('click', () => onPick(p));
      item.append(card);
      grid.append(item);
    }
    return grid;
  }

  // --- Painel "Personas" ------------------------------------------------------------------

  function renderPanel(): void {
    const head = el('header', 'overlay-head');
    const title = el('h2', '', 'Personas');
    title.id = 'persona-title';
    head.append(title, button('Fechar', closePanel, 'ghost'));

    const status = el('p', 'overlay-status');
    status.id = 'persona-status';
    status.textContent = `Agora: ${state.current.name}, ${state.current.role.toLowerCase()}. Todas lembram do que você contou.`;

    const grid = personaGrid((p) => {
      if (p.id === state.current.id) {
        closePanel();
        return;
      }
      status.textContent = `Chamando ${p.name}…`;
      void stella.personas
        .select(p.id)
        .then(closePanel)
        .catch((err: unknown) => (status.textContent = cleanIpcError(err)));
    });

    const foot = el('footer', 'overlay-foot');
    foot.append(
      el(
        'p',
        'hint',
        'O signo só serve para sugerir uma companhia. Ninguém aqui faz horóscopo nem julga você por ele.',
      ),
      button('Refazer sugestão', () => {
        closePanel();
        openOnboarding('sign');
      }),
    );
    panel.replaceChildren(head, status, grid, foot);
  }

  function openPanel(): void {
    renderPanel();
    panel.hidden = false;
    openButton.setAttribute('aria-expanded', 'true');
    panel.querySelector<HTMLButtonElement>('button')?.focus();
  }

  function closePanel(): void {
    panel.hidden = true;
    openButton.setAttribute('aria-expanded', 'false');
  }

  openButton.addEventListener('click', openPanel);
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePanel();
  });

  // --- Onboarding -------------------------------------------------------------------------

  let sign: SignId | null = null;
  let preference: Preference | null = null;

  function step(titleText: string, ...content: (HTMLElement | string)[]): void {
    const title = el('h2', 'onboarding-title', titleText);
    title.id = 'onboarding-title';
    onboarding.replaceChildren(
      title,
      ...content.map((c) => (typeof c === 'string' ? el('p', '', c) : c)),
    );
    onboarding.querySelector<HTMLElement>('button, input, select')?.focus();
  }

  function row(...buttons: HTMLElement[]): HTMLElement {
    const r = el('div', 'onboarding-actions');
    r.append(...buttons);
    return r;
  }

  const signName = (id: SignId) => state.signs.find((s) => s.id === id)?.name ?? id;

  /** 1. As 4 personas se apresentam em turnos (nenhuma parece a padrão). */
  function welcome(): void {
    const list = el('ul', 'welcome-list');
    const go = button('Vamos lá', askSign);
    go.disabled = true;
    step(
      'Boas-vindas!',
      'Somos quatro, e cada uma tem um jeito. Todas lembram do que você contar.',
      list,
      row(go),
    );
    const active = state.personas.filter((p) => p.status === 'active');
    active.forEach((p, i) => {
      setTimeout(() => {
        const item = el('li', 'welcome-item');
        item.dataset['element'] = p.element;
        const text = el('div');
        text.append(el('strong', '', `${p.name} · ${p.role}`), el('p', '', p.greeting));
        item.append(miniAvatar(p.element, 44), text);
        list.append(item);
        if (i === active.length - 1) go.disabled = false;
      }, i * 700);
    });
  }

  /** 2. Qual é o seu signo? */
  function askSign(): void {
    const grid = el('div', 'sign-grid');
    for (const s of state.signs) {
      grid.append(
        button(s.name, () => {
          sign = s.id;
          askPreference();
        }),
      );
    }
    step(
      'Qual é o seu signo?',
      'Ele só serve para sugerir uma companhia. Ninguém aqui faz horóscopo.',
      grid,
      row(
        button('Não sei, vou informar a data de nascimento', askDate, 'ghost'),
        button(
          'Prefiro não dizer',
          () => {
            sign = null;
            preference = null;
            chooseAll();
          },
          'ghost',
        ),
      ),
    );
  }

  /** 2b. Data de nascimento (só dia e mês; não é guardada). */
  function askDate(): void {
    const form = el('form', 'date-form');
    const day = el('input');
    day.type = 'number';
    day.min = '1';
    day.max = '31';
    day.required = true;
    day.id = 'birth-day';
    day.setAttribute('aria-label', 'Dia');
    day.placeholder = 'Dia';
    const month = el('select');
    month.id = 'birth-month';
    month.setAttribute('aria-label', 'Mês');
    MONTHS.forEach((m, i) => {
      const opt = el('option', '', m);
      opt.value = String(i + 1);
      month.append(opt);
    });
    const error = el('p', 'form-error');
    error.setAttribute('role', 'alert');
    const submit = el('button', '', 'Continuar');
    submit.type = 'submit';
    form.append(day, month, submit);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void stella.personas
        .signsForDate(Number(day.value), Number(month.value))
        .then(confirmSign)
        .catch((err: unknown) => (error.textContent = cleanIpcError(err)));
    });
    step(
      'Quando você nasceu?',
      'Só o dia e o mês. A data não fica guardada, só o signo.',
      form,
      error,
      row(button('Voltar', askSign, 'ghost')),
    );
  }

  /** 2c. Confirma o signo da data; no limite entre dois, o usuário escolhe. */
  function confirmSign(signs: SignId[]): void {
    const pick = (s: SignId) => () => {
      sign = s;
      askPreference();
    };
    const [first, second] = signs;
    if (!first) return askDate();
    if (!second) {
      step(
        `Então você é de ${signName(first)}, certo?`,
        row(button('Sim', pick(first)), button('Escolher outro', askSign, 'ghost')),
      );
      return;
    }
    step(
      'Você nasceu bem no limite entre dois signos.',
      'A data exata muda um pouco de ano para ano. Qual combina mais com você?',
      row(button(signName(first), pick(first)), button(signName(second), pick(second))),
    );
  }

  /** 3. Que tipo de companhia você quer? */
  function askPreference(): void {
    const options = el('div', 'preference-list');
    for (const pref of ['similar', 'compatible', 'contrast'] as const) {
      const [title, detail] = PREFERENCE_TEXT[pref];
      const b = button('', () => {
        preference = pref;
        void stella.personas
          .suggest(sign as SignId, pref)
          .then(showSuggestion)
          .catch(() => chooseAll());
      });
      b.dataset['preference'] = pref;
      b.append(el('strong', '', title), el('span', '', detail));
      options.append(b);
    }
    step('Que tipo de companhia você quer?', options, row(button('Voltar', askSign, 'ghost')));
  }

  /** 4. Sugestão, com uma frase dela e o motivo. */
  function showSuggestion(s: SuggestionView): void {
    applyColors(s.persona);
    const card = el('div', 'suggestion');
    card.dataset['element'] = s.persona.element;
    const text = el('div');
    text.append(
      el('strong', 'suggestion-name', s.persona.name),
      el('span', 'suggestion-role', s.persona.role),
      el('p', 'suggestion-greeting', `“${s.persona.greeting}”`),
    );
    card.append(miniAvatar(s.persona.element, 72), text);
    const reason = el('p', 'suggestion-reason', s.reason);
    reason.id = 'suggestion-reason';
    step(
      `Sugestão: ${s.persona.name}`,
      card,
      reason,
      row(
        button(`Começar com ${ela(s.persona)}`, () => void finish(s.persona.id)),
        button('Ver todas', chooseAll, 'ghost'),
      ),
    );
  }

  /** 5. Todas: as ativas para escolher e as futuras esmaecidas, "em breve". */
  function chooseAll(): void {
    step(
      'Escolha sua companhia',
      'Dá para trocar quando quiser, no botão Personas. Todas lembram do que você contar.',
      // No onboarding ninguém aparece como atual: a escolha ainda não foi feita.
      personaGrid((p) => void finish(p.id), false),
    );
  }

  async function finish(personaId: string): Promise<void> {
    try {
      await stella.personas.finishOnboarding({ personaId, sign, preference });
      onboarding.hidden = true;
      $<HTMLTextAreaElement>('input').focus();
    } catch (err) {
      onboarding.append(el('p', 'form-error', cleanIpcError(err)));
    }
  }

  function openOnboarding(from: 'welcome' | 'sign'): void {
    sign = state.sign;
    preference = state.preference;
    onboarding.hidden = false;
    if (from === 'welcome') welcome();
    else askSign();
  }

  if (!state.onboarded) openOnboarding('welcome');
}

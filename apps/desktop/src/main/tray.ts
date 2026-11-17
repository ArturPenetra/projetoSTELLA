import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Menu, nativeImage, Tray, type MenuItemConstructorOptions } from 'electron';
import { APP_NAME, type ElementId } from '@stella/core';

const here = fileURLToPath(new URL('.', import.meta.url));

export interface MenuPersona {
  id: string;
  name: string;
  element: ElementId;
}

export interface AppMenuActions {
  openChat(): void;
  isCompanionVisible(): boolean;
  setCompanionVisible(visible: boolean): void;
  /** Personas que podem ser escolhidas e a atual. */
  personas(): { current: MenuPersona; active: MenuPersona[] };
  selectPersona(id: string): void;
  quit(): void;
}

/** Menu usado na bandeja e no clique direito do avatar. */
export function buildAppMenu(actions: AppMenuActions): Menu {
  const visible = actions.isCompanionVisible();
  const { current, active } = actions.personas();
  const template: MenuItemConstructorOptions[] = [
    { label: 'Abrir chat', click: () => actions.openChat() },
    {
      label: 'Persona',
      submenu: active.map((p) => ({
        label: p.name,
        type: 'radio',
        checked: p.id === current.id,
        click: () => actions.selectPersona(p.id),
      })),
    },
    {
      label: visible ? `Esconder ${current.name}` : `Mostrar ${current.name}`,
      click: () => actions.setCompanionVisible(!visible),
    },
    { type: 'separator' },
    { label: 'Sair', click: () => actions.quit() },
  ];
  return Menu.buildFromTemplate(template);
}

/** Ícone com a paleta do elemento (tray-fogo.png etc.; o @2x é usado sozinho em telas 200%). */
function iconFor(element: ElementId) {
  return nativeImage.createFromPath(join(here, `../../resources/tray-${element}.png`));
}

/** Ícone na bandeja: clique abre o chat; clique direito mostra o menu. */
export function createTray(actions: AppMenuActions): Tray {
  const tray = new Tray(iconFor(actions.personas().current.element));
  updateTray(tray, actions.personas().current);
  tray.on('click', () => actions.openChat());
  // Monta o menu na hora, para os textos estarem sempre certos.
  tray.on('right-click', () => tray.popUpContextMenu(buildAppMenu(actions)));
  return tray;
}

/** O nome da persona aparece na bandeja: personas do mesmo elemento têm a mesma cor. */
export function updateTray(tray: Tray, persona: MenuPersona): void {
  if (tray.isDestroyed()) return;
  tray.setImage(iconFor(persona.element));
  tray.setToolTip(`${APP_NAME} · ${persona.name}`);
}

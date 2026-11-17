import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Menu, nativeImage, Tray, type MenuItemConstructorOptions } from 'electron';
import { APP_NAME } from '@stella/core';

const here = fileURLToPath(new URL('.', import.meta.url));

export interface AppMenuActions {
  openChat(): void;
  isCompanionVisible(): boolean;
  setCompanionVisible(visible: boolean): void;
  quit(): void;
}

/** Menu usado na bandeja e no clique direito do avatar. */
export function buildAppMenu(actions: AppMenuActions): Menu {
  const visible = actions.isCompanionVisible();
  const template: MenuItemConstructorOptions[] = [
    { label: 'Abrir chat', click: () => actions.openChat() },
    {
      label: visible ? `Esconder a ${APP_NAME}` : `Mostrar a ${APP_NAME}`,
      click: () => actions.setCompanionVisible(!visible),
    },
    { type: 'separator' },
    { label: 'Sair', click: () => actions.quit() },
  ];
  return Menu.buildFromTemplate(template);
}

/** Ícone na bandeja: clique abre o chat; clique direito mostra o menu. */
export function createTray(actions: AppMenuActions): Tray {
  // tray.png tem 16 px; o Electron usa tray@2x.png sozinho em telas com escala 200%.
  const icon = nativeImage.createFromPath(join(here, '../../resources/tray.png'));
  const tray = new Tray(icon);
  tray.setToolTip(APP_NAME);
  tray.on('click', () => actions.openChat());
  // Monta o menu na hora, para o texto "Mostrar/Esconder" estar sempre certo.
  tray.on('right-click', () => tray.popUpContextMenu(buildAppMenu(actions)));
  return tray;
}

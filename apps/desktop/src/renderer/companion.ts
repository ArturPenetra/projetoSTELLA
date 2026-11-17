import type { AvatarMood, AvatarSnapshot } from '@stella/core';
import avatarSvg from '../../../../assets/avatar/zodi-avatar.svg?raw';
import type { CompanionApi } from '../shared/ipc.js';

declare global {
  interface Window {
    companion: CompanionApi;
  }
}

const api = window.companion;

function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Elemento #${id} não encontrado`);
  return el as T;
}

const avatar = $<HTMLElement>('avatar');
const bubble = $<HTMLElement>('bubble');
const bubbleText = $<HTMLElement>('bubble-text');

// O SVG é um arquivo do próprio app (não vem de fora), por isso pode entrar como HTML.
avatar.innerHTML = avatarSvg;
const svg = avatar.querySelector('svg');
if (!svg) throw new Error('SVG do avatar não encontrado');
svg.removeAttribute('role');
svg.setAttribute('aria-hidden', 'true');

// O balão usa a cor profunda do elemento da persona (contraste ≥ 4,5:1 sobre o fundo claro).
bubble.style.setProperty('--profunda', getComputedStyle(svg).getPropertyValue('--profunda'));

// --- Estado -----------------------------------------------------------------------------

/** Enquanto fala sem áudio, a boca abre e fecha num ritmo de fala. */
let mouthTimer: ReturnType<typeof setInterval> | undefined;

function setMouthMoving(moving: boolean): void {
  if (moving && !mouthTimer) {
    mouthTimer = setInterval(() => svg?.classList.toggle('falando'), 140);
  } else if (!moving && mouthTimer) {
    clearInterval(mouthTimer);
    mouthTimer = undefined;
    svg?.classList.remove('falando');
  }
}

function render(state: AvatarSnapshot): void {
  const mood: AvatarMood = state.mood;
  avatar.dataset['mood'] = mood;
  svg?.classList.toggle('feliz', mood === 'feliz');
  setMouthMoving(mood === 'falando');

  if (state.bubble === null) {
    bubble.hidden = true;
    return;
  }
  bubble.hidden = false;
  bubble.classList.toggle('is-typing', state.typing);
  bubbleText.textContent = state.bubble;
}

api.onState(render);

// --- Mouse: cliques atravessam fora do avatar ----------------------------------------------

/** Partes que contam como "o avatar": o desenho (sem aura e brilhos) e o balão. */
function isHit(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest('.enfeite')) return false;
  if (target.closest('.hit')) return true;
  return target instanceof SVGElement && target !== svg && avatar.contains(target);
}

let interactive = false;
let drag: { x: number; y: number; moved: boolean; pointerId: number } | undefined;

function setInteractive(value: boolean): void {
  if (value === interactive) return;
  interactive = value;
  api.setInteractive(value);
}

document.addEventListener('mousemove', (e) => {
  if (!drag) setInteractive(isHit(e.target));
});
document.addEventListener('mouseleave', () => {
  if (!drag) setInteractive(false);
});

// --- Arrastar e clicar no avatar ------------------------------------------------------------

/** Movimento mínimo (px) para virar arraste em vez de clique. */
const DRAG_THRESHOLD = 4;

avatar.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || !isHit(e.target)) return;
  try {
    // Continua recebendo o movimento mesmo se o mouse sair da janela durante o arraste.
    avatar.setPointerCapture(e.pointerId);
  } catch {
    // Ponteiro que não está ativo (por exemplo, evento simulado): arrasta sem captura.
  }
  drag = { x: e.screenX, y: e.screenY, moved: false, pointerId: e.pointerId };
  api.dragStart();
});

avatar.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.pointerId) return;
  const dx = e.screenX - drag.x;
  const dy = e.screenY - drag.y;
  if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
  drag.moved = true;
  avatar.classList.add('dragging');
  api.dragMove(dx, dy);
});

function endDrag(e: PointerEvent, cancelled: boolean): void {
  if (!drag || e.pointerId !== drag.pointerId) return;
  const wasClick = !drag.moved && !cancelled;
  drag = undefined;
  avatar.classList.remove('dragging');
  api.dragEnd();
  if (wasClick) api.openChat();
}

avatar.addEventListener('pointerup', (e) => endDrag(e, false));
avatar.addEventListener('pointercancel', (e) => endDrag(e, true));

avatar.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (isHit(e.target)) api.openMenu();
});

bubble.addEventListener('click', () => api.openChat());

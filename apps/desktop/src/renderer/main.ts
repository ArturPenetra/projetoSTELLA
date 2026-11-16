import type { StellaApi } from '../preload/index.js';

declare global {
  interface Window {
    stella: StellaApi;
  }
}

const { versions } = window.stella;
const el = document.getElementById('versions');
if (el)
  el.textContent = `Electron ${versions.electron} · Chrome ${versions.chrome} · Node ${versions.node}`;

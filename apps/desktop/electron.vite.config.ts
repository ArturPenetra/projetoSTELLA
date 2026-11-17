import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

const here = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['@stella/core'] })],
    build: {
      rollupOptions: { input: { index: resolve(here, 'src/main/index.ts') } },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      // Preload em sandbox não pode dar require() em pedaços compartilhados: cada um sai inteiro.
      isolatedEntries: true,
      rollupOptions: {
        input: {
          chat: resolve(here, 'src/preload/chat.ts'),
          companion: resolve(here, 'src/preload/companion.ts'),
        },
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: resolve(here, 'src/renderer'),
    build: {
      rollupOptions: {
        input: {
          index: resolve(here, 'src/renderer/index.html'),
          companion: resolve(here, 'src/renderer/companion.html'),
        },
      },
    },
  },
});

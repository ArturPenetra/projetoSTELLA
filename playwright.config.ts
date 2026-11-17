import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 90_000,
  // Folga para máquinas ocupadas (por exemplo, com um jogo aberto): o padrão de 5 s falhava.
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: 'list',
  outputDir: 'test-results',
});

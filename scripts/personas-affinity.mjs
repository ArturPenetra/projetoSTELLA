// Gera config/affinity.json a partir das regras e do catálogo em personas/.
// Uso: npm run personas:affinity   (o teste correspondente falha se o arquivo estiver velho)
import { spawnSync } from 'node:child_process';

const result = spawnSync(
  'npx',
  ['vitest', 'run', 'packages/core/src/personas/personas.test.ts', '-t', 'affinity.json'],
  { stdio: 'inherit', shell: true, env: { ...process.env, UPDATE_AFFINITY: '1' } },
);
process.exit(result.status ?? 1);

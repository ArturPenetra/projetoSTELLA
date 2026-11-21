// Confere se os módulos nativos (better-sqlite3 + sqlite-vec + sherpa-onnx) carregam no runtime do Electron.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const probe = fileURLToPath(new URL('./native-probe.cjs', import.meta.url));

const result = spawnSync(electronPath, [probe], {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
});
process.exit(result.status ?? 1);

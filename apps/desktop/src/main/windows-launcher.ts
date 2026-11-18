import { spawn, type ChildProcess } from 'node:child_process';
import { basename, extname, join } from 'node:path';
import { shell } from 'electron';
import type { LaunchResult, Launcher } from '@stella/core';

/** Quanto tempo esperar uma janela do app aparecer. */
export const WINDOW_TIMEOUT_MS = 6000;

/**
 * Se o processo do app começou a rodar, espera a janela até este tempo. Achado em
 * 18/11/2026: o Opera GX, aberto a frio, levava mais de 6 s para mostrar a janela, e a
 * Stella dizia que nada tinha aberto.
 */
export const SLOW_START_TIMEOUT_MS = 25_000;

/** Depois disso sem janela nova, se o app já estava aberto, a Stella mostra a janela dele. */
const ALREADY_OPEN_AFTER_MS = 1500;

/** Nome de processo seguro para pôr no script ("Discord", "notepad"). */
export function safeProcessName(name: string | undefined): string | undefined {
  return name && /^[\w .-]{1,64}$/.test(name) ? name : undefined;
}

/**
 * Script do PowerShell que vigia as janelas do Windows: avisa "READY", tira a "foto" das
 * janelas visíveis e da janela da frente, espera o sinal (o app foi aberto) e procura uma
 * janela nova ou de outro programa que veio para a frente. Se o app já estava aberto (por
 * exemplo, minimizado), restaura e traz a janela dele para a frente. Não roda mais nada.
 */
function watcherScript(
  ownPid: number,
  timeoutMs: number,
  slowTimeoutMs: number,
  target: string | undefined,
): string {
  return [
    '$ErrorActionPreference = "Stop"',
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    "Add-Type -TypeDefinition @'",
    'using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;',
    'public static class StellaWindows {',
    '  delegate bool EnumProc(IntPtr h, IntPtr l);',
    '  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);',
    '  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);',
    '  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);',
    '  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);',
    '  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);',
    '  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();',
    '  public static uint Owner(IntPtr h) { uint p; GetWindowThreadProcessId(h, out p); return p; }',
    '  public static string Title(IntPtr h) { var s = new StringBuilder(512); GetWindowText(h, s, 512); return s.ToString(); }',
    '  public static List<long> Visible(uint own) {',
    '    var r = new List<long>();',
    '    EnumWindows((h, l) => { if (IsWindowVisible(h) && GetWindowTextLength(h) > 0 && Owner(h) != own) r.Add(h.ToInt64()); return true; }, IntPtr.Zero);',
    '    return r;',
    '  }',
    '  public static long Foreground() { return GetForegroundWindow().ToInt64(); }',
    '  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);',
    '  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);',
    '  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);',
    '  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);',
    '  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);',
    '  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();',
    '  public static long FirstOf(HashSet<uint> pids, List<long> only) {',
    '    long found = 0;',
    '    EnumWindows((h, l) => { if (pids.Contains(Owner(h)) && only.Contains(h.ToInt64()) && IsWindowVisible(h) && GetWindowTextLength(h) > 0) { found = h.ToInt64(); return false; } return true; }, IntPtr.Zero);',
    '    return found;',
    '  }',
    // Restaurar uma janela minimizada é sempre permitido; passar para a frente usa o
    // AttachThreadInput (o Windows bloqueia SetForegroundWindow de processos em segundo plano).
    '  public static void Show(IntPtr h) {',
    '    if (IsIconic(h)) ShowWindow(h, 9);',
    '    uint p; uint front = GetWindowThreadProcessId(GetForegroundWindow(), out p);',
    '    uint me = GetCurrentThreadId();',
    '    AttachThreadInput(me, front, true);',
    '    BringWindowToTop(h); SetForegroundWindow(h);',
    '    AttachThreadInput(me, front, false);',
    '  }',
    '}',
    "'@",
    `$target = ${target ? `"${target}"` : '$null'}`,
    `$own = [uint32]${Math.trunc(ownPid)}`,
    // Pronto (compilado) e esperando: a "foto" das janelas só é tirada na hora de abrir.
    '[Console]::Out.WriteLine("READY"); [Console]::Out.Flush()',
    '$null = [Console]::In.ReadLine()',
    '$before = [StellaWindows]::Visible($own)',
    '$front = [StellaWindows]::Foreground()',
    // Processos do app que já rodavam: um processo novo quer dizer que ele está abrindo.
    '$oldPids = New-Object "System.Collections.Generic.HashSet[uint32]"',
    'if ($target) { foreach ($p in Get-Process -Name $target -ErrorAction SilentlyContinue) { [void]$oldPids.Add([uint32]$p.Id) } }',
    '[Console]::Out.WriteLine("SNAPPED"); [Console]::Out.Flush()',
    '$null = [Console]::In.ReadLine()',
    '$start = [DateTime]::Now',
    `$deadline = $start.AddMilliseconds(${Math.trunc(timeoutMs)})`,
    `$slowDeadline = $start.AddMilliseconds(${Math.trunc(slowTimeoutMs)})`,
    '$starting = $false',
    'while ([DateTime]::Now -lt $deadline -or ($starting -and [DateTime]::Now -lt $slowDeadline)) {',
    '  Start-Sleep -Milliseconds 300',
    '  foreach ($h in [StellaWindows]::Visible($own)) {',
    '    if (-not $before.Contains($h)) { [Console]::Out.WriteLine("NEW " + [StellaWindows]::Title([IntPtr]$h)); exit 0 }',
    '  }',
    '  $f = [StellaWindows]::Foreground()',
    '  if ($f -ne 0 -and $f -ne $front -and [StellaWindows]::Owner([IntPtr]$f) -ne $own) { [Console]::Out.WriteLine("FRONT " + [StellaWindows]::Title([IntPtr]$f)); exit 0 }',
    '  if ($target) {',
    '    $pids = New-Object "System.Collections.Generic.HashSet[uint32]"',
    '    $starting = $false',
    '    foreach ($p in Get-Process -Name $target -ErrorAction SilentlyContinue) {',
    '      [void]$pids.Add([uint32]$p.Id)',
    '      if (-not $oldPids.Contains([uint32]$p.Id)) { $starting = $true }',
    '    }',
    `    if (([DateTime]::Now - $start).TotalMilliseconds -ge ${ALREADY_OPEN_AFTER_MS}) {`,
    '      $h = [StellaWindows]::FirstOf($pids, $before)',
    '      if ($h -ne 0) { [StellaWindows]::Show([IntPtr]$h); [Console]::Out.WriteLine("ALREADY " + [StellaWindows]::Title([IntPtr]$h)); exit 0 }',
    '    }',
    '  }',
    '}',
    // Sem janela, mas o app está rodando há pouco: está carregando (não é "não abriu").
    'if ($starting) { [Console]::Out.WriteLine("STARTING") } else { [Console]::Out.WriteLine("NONE") }',
  ].join('\n');
}

/** Vigia que não foi usado neste tempo é fechado (não fica um PowerShell parado à toa). */
const IDLE_MS = 120_000;

interface Watcher {
  /** Tira a "foto" das janelas (logo antes de abrir o app). */
  snapshot(): Promise<void>;
  /** Avisa que o app foi aberto e espera o resultado (NEW, FRONT, ALREADY, STARTING ou NONE). */
  check(): Promise<string>;
  cancel(): void;
}

/** Inicia o vigia e espera ele ficar pronto (o PowerShell compila o código uma vez). */
function startWatcher(
  timeoutMs: number,
  slowTimeoutMs: number,
  target: string | undefined,
): Promise<Watcher> {
  const powershell = join(
    process.env['SystemRoot'] ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  const encoded = Buffer.from(
    watcherScript(process.pid, timeoutMs, slowTimeoutMs, target),
    'utf16le',
  ).toString('base64');
  const child: ChildProcess = spawn(
    powershell,
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] },
  );
  let output = '';
  const waiters: { word: string; done: (rest: string) => void }[] = [];
  child.stdout?.setEncoding('utf8');
  child.stdout?.on('data', (data: string) => {
    output += data;
    const next = waiters[0];
    if (next && output.includes(next.word)) {
      waiters.shift();
      output = output.slice(output.indexOf(next.word) + next.word.length);
      next.done(output);
    }
  });
  const waitFor = (word: string, ms: number) =>
    new Promise<void>((resolveWait, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`o vigia de janelas não respondeu (${word})`)),
        ms,
      );
      waiters.push({
        word,
        done: () => {
          clearTimeout(timer);
          resolveWait();
        },
      });
    });

  const idle = setTimeout(() => child.kill(), IDLE_MS);
  return new Promise((resolvePromise, reject) => {
    child.once('error', reject);
    waitFor('READY', 20_000).then(
      () =>
        resolvePromise({
          snapshot: async () => {
            clearTimeout(idle);
            const snapped = waitFor('SNAPPED', 5_000);
            child.stdin?.write('\n');
            await snapped;
          },
          check: () =>
            new Promise((resolveCheck) => {
              child.once('close', () =>
                resolveCheck(output.trim().split(/\r?\n/).at(-1) ?? 'NONE'),
              );
              child.stdin?.end('\n');
            }),
          cancel: () => {
            clearTimeout(idle);
            child.kill();
          },
        }),
      (err: unknown) => {
        child.kill();
        reject(err);
      },
    );
  });
}

/**
 * Abre como um duplo clique (ShellExecute, via `shell.openPath`): funciona com programas,
 * atalhos do Menu Iniciar e apps que usam um iniciador; o app aberto não fica preso à
 * Stella. Depois confere se uma janela apareceu, para só dizer "abri" quando abriu.
 *
 * Achado em 17/11/2026: abrindo como processo filho, o calc.exe (um atalho para o app
 * Calculadora) terminava sem abrir nada e a Stella dizia "Abri" mesmo assim.
 *
 * `prepare()` começa a preparar o vigia enquanto o usuário lê a confirmação; sem isso, o
 * app só abria depois de 3 a 7 s (o PowerShell compilando).
 */
export function createWindowsLauncher(
  timeoutMs = WINDOW_TIMEOUT_MS,
  slowTimeoutMs = SLOW_START_TIMEOUT_MS,
): Launcher {
  let prepared: { path: string; watcher: Promise<Watcher | undefined> } | undefined;
  const warm = (path: string) =>
    startWatcher(timeoutMs, slowTimeoutMs, processNameFor(path)).catch((err: unknown) => {
      console.warn('[ferramentas] não consegui vigiar as janelas', err);
      return undefined;
    });

  const launch = async (path: string): Promise<LaunchResult> => {
    let pending = prepared?.watcher;
    if (prepared && prepared.path !== path) {
      void prepared.watcher.then((w) => w?.cancel());
      pending = undefined;
    }
    const watcher = await (pending ?? warm(path));
    prepared = undefined;
    const ready = await watcher
      ?.snapshot()
      .then(() => true)
      .catch(() => false);
    const error = await shell.openPath(path);
    if (error) {
      watcher?.cancel();
      return { opened: false, detail: `o Windows respondeu: ${error}` };
    }
    // Sem o vigia, não dá para conferir: confia no Windows ter aceitado o pedido.
    if (!watcher || !ready) {
      watcher?.cancel();
      return { opened: true };
    }
    const result = await watcher.check();
    const detail = result.slice(result.indexOf(' ') + 1);
    if (result.startsWith('NEW ') || result.startsWith('FRONT ')) return { opened: true, detail };
    if (result.startsWith('ALREADY ')) return { opened: true, alreadyOpen: true, detail };
    if (result === 'STARTING') return { opened: true, starting: true };
    return { opened: false };
  };
  return Object.assign(launch, {
    prepare: (path: string) => {
      if (prepared?.path === path) return;
      if (prepared) void prepared.watcher.then((w) => w?.cancel());
      prepared = { path, watcher: warm(path) };
    },
  });
}

/**
 * Nome do processo do app (para achar a janela se ele já estiver aberto): o executável,
 * ou, num atalho, o executável para onde ele aponta.
 */
export function processNameFor(path: string): string | undefined {
  let exe = path;
  if (extname(path).toLowerCase() === '.lnk') {
    try {
      exe = shell.readShortcutLink(path).target;
    } catch {
      return undefined;
    }
  }
  return safeProcessName(basename(exe, extname(exe)));
}

/** Para onde um atalho aponta, com os argumentos (para mostrar na confirmação). */
export function describeShortcut(path: string): string | undefined {
  try {
    const link = shell.readShortcutLink(path);
    return [link.target, link.args].filter(Boolean).join(' ') || undefined;
  } catch {
    return undefined;
  }
}

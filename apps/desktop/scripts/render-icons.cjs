// Gera os ícones da bandeja a partir do rosto do avatar (assets/avatar/zodi-avatar.svg).
// Uso: npm run icons -w @stella/desktop   (roda dentro do Electron, sem internet)
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { app, BrowserWindow } = require('electron');

const root = join(__dirname, '..');
const svgPath = join(root, '../../assets/avatar/zodi-avatar.svg');
const outDir = join(root, 'resources');
// Recorte quadrado do rosto e do cabelo.
const FACE_VIEWBOX = '58 56 284 284';
// Desenha grande uma vez e reduz: fica mais nítido que desenhar em 16 px.
const RENDER_SIZE = 128;
const OUTPUTS = [
  ['tray.png', 16],
  ['tray@2x.png', 32],
];

app.disableHardwareAcceleration();

async function render() {
  const svg = readFileSync(svgPath, 'utf8')
    .replace(/viewBox="[^"]*"/, `viewBox="${FACE_VIEWBOX}"`)
    .replace('<svg ', `<svg width="${RENDER_SIZE}" height="${RENDER_SIZE}" `);
  const html = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:transparent;overflow:hidden">${svg}</body></html>`;

  const win = new BrowserWindow({
    width: RENDER_SIZE,
    height: RENDER_SIZE,
    show: false,
    frame: false,
    transparent: true,
    useContentSize: true,
    webPreferences: { offscreen: true },
  });
  const dir = mkdtempSync(join(tmpdir(), 'stella-icons-'));
  const page = join(dir, 'icon.html');
  writeFileSync(page, html, 'utf8');
  await win.loadFile(page);
  rmSync(dir, { recursive: true, force: true });

  // Janela offscreen: a imagem chega pelo evento 'paint'. Só vale uma pintura feita depois
  // de a página carregar e que tenha o desenho (pixels de cores diferentes).
  const image = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('o desenho não ficou pronto')), 15000);
    win.webContents.on('paint', (_e, _dirty, frame) => {
      const colors = new Set();
      const bitmap = frame.toBitmap();
      for (let i = 0; i < bitmap.length; i += 4 * 97) colors.add(bitmap.readUInt32LE(i));
      if (colors.size < 8) return;
      clearTimeout(timer);
      resolve(frame);
    });
    win.webContents.setFrameRate(10);
    win.webContents.invalidate();
  });
  win.destroy();

  for (const [name, size] of OUTPUTS) {
    const png = image.resize({ width: size, height: size, quality: 'best' }).toPNG();
    writeFileSync(join(outDir, name), png);
    console.log(`${name}: ${size}x${size}`);
  }
}

void app
  .whenReady()
  .then(render)
  .then(() => app.quit())
  .catch((err) => {
    console.error(err);
    app.exit(1);
  });

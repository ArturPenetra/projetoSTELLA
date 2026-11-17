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
const ELEMENTS = ['fogo', 'terra', 'ar', 'agua'];
const SIZES = [
  ['', 16],
  ['@2x', 32],
];

app.disableHardwareAcceleration();

/** Desenha os 4 rostos lado a lado numa página só e devolve a imagem inteira. */
async function renderStrip() {
  const base = readFileSync(svgPath, 'utf8')
    .replace(/viewBox="[^"]*"/, `viewBox="${FACE_VIEWBOX}"`)
    .replace('<svg ', `<svg width="${RENDER_SIZE}" height="${RENDER_SIZE}" `);
  const faces = ELEMENTS.map((el) =>
    base.replace(/data-element="[^"]*"/, `data-element="${el}"`),
  ).join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>svg{display:block;float:left}</style></head><body style="margin:0;background:transparent;overflow:hidden">${faces}</body></html>`;

  const width = RENDER_SIZE * ELEMENTS.length;
  const win = new BrowserWindow({
    width,
    height: RENDER_SIZE,
    show: false,
    frame: false,
    transparent: true,
    useContentSize: true,
    webPreferences: { offscreen: true },
  });
  const dir = mkdtempSync(join(tmpdir(), 'stella-icons-'));
  const page = join(dir, 'icons.html');
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
      if (colors.size < 16 || frame.getSize().width < width) return;
      clearTimeout(timer);
      resolve(frame);
    });
    win.webContents.setFrameRate(10);
    win.webContents.invalidate();
  });
  win.destroy();
  return image;
}

async function render() {
  const strip = await renderStrip();
  ELEMENTS.forEach((element, i) => {
    const face = strip.crop({ x: i * RENDER_SIZE, y: 0, width: RENDER_SIZE, height: RENDER_SIZE });
    for (const [suffix, size] of SIZES) {
      const name = `tray-${element}${suffix}.png`;
      writeFileSync(
        join(outDir, name),
        face.resize({ width: size, height: size, quality: 'best' }).toPNG(),
      );
      console.log(`${name}: ${size}x${size}`);
    }
  });
}

void app
  .whenReady()
  .then(render)
  .then(() => app.quit())
  .catch((err) => {
    console.error(err);
    app.exit(1);
  });

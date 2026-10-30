// Builds every app icon from the SVG sources: `npm run icons`.
// assets/icon.svg (macOS tile with margin) -> assets/icon.icns and assets/icon.png
// public/icon.svg (full-bleed mark)         -> assets/icon.ico
// Also renders assets/social-preview.png for the GitHub repository card.
import { app, BrowserWindow } from 'electron';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assets = path.join(root, 'assets');
const tile = fs.readFileSync(path.join(assets, 'icon.svg'), 'utf8');
const mark = fs.readFileSync(path.join(root, 'public', 'icon.svg'), 'utf8');
const sized = (svg, size) => svg.replace('<svg ', `<svg width="${size}" height="${size}" `);

// PNG-compressed ICO entries are supported by Windows Vista and later.
function ico(images) {
  const header = Buffer.alloc(6); header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map(({ size, png }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt16LE(1, 4); entry.writeUInt16LE(32, 6); entry.writeUInt32LE(png.length, 8); entry.writeUInt32LE(offset, 12);
    offset += png.length; return entry;
  });
  return Buffer.concat([header, ...entries, ...images.map(image => image.png)]);
}

app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1280, height: 640, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html,<body style="margin:0">');
  // Rasterize the vector at the target size so small icons stay sharp.
  const render = async (svg, size) => Buffer.from(await win.webContents.executeJavaScript(`(async () => {
    const image = new Image(); image.src = 'data:image/svg+xml;base64,${Buffer.from(sized(svg, size)).toString('base64')}'; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = ${size};
    canvas.getContext('2d').drawImage(image, 0, 0, ${size}, ${size});
    return canvas.toDataURL('image/png').split(',')[1];
  })()`), 'base64');

  const iconset = fs.mkdtempSync(path.join(os.tmpdir(), 'throughline-')) + '/icon.iconset';
  fs.mkdirSync(iconset);
  for (const size of [16, 32, 128, 256, 512]) {
    fs.writeFileSync(path.join(iconset, `icon_${size}x${size}.png`), await render(tile, size));
    fs.writeFileSync(path.join(iconset, `icon_${size}x${size}@2x.png`), await render(tile, size * 2));
  }
  if (process.platform === 'darwin') execFileSync('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', path.join(assets, 'icon.icns')]);
  else console.warn('Skipping icon.icns: iconutil is only available on macOS.');
  fs.writeFileSync(path.join(assets, 'icon.png'), await render(tile, 512));
  fs.writeFileSync(path.join(assets, 'icon.ico'), ico(await Promise.all([16, 24, 32, 48, 64, 128, 256].map(async size => ({ size, png: await render(mark, size) })))));
  fs.rmSync(path.dirname(iconset), { recursive: true, force: true });

  const card = `<!doctype html><meta charset="utf-8"><style>
    body { margin: 0; width: 1280px; height: 640px; display: flex; align-items: center; gap: 56px; padding: 0 120px; box-sizing: border-box;
      background: radial-gradient(circle at 18% 20%, #1d2846 0, #0b1020 60%); color: #e9edf5; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    img { width: 260px; height: 260px; flex: none; }
    h1 { margin: 0; font-size: 92px; font-weight: 700; letter-spacing: -0.03em; }
    p { margin: 16px 0 0; max-width: 680px; color: #aeb8cc; font-size: 34px; line-height: 1.35; }
    small { display: block; margin-top: 28px; color: #7f8aa3; font-size: 24px; letter-spacing: 0.01em; }
  </style><img src="data:image/svg+xml;base64,${Buffer.from(sized(tile, 260)).toString('base64')}"><div><h1>Throughline</h1>
    <p>One coding conversation per project, shared across Claude Code, Codex and your teammates.</p>
    <small>Open source · runs on your own Claude and Codex subscriptions</small></div>`;
  await win.loadURL('data:text/html;base64,' + Buffer.from(card).toString('base64'));
  await new Promise(resolve => setTimeout(resolve, 300));
  const preview = await win.webContents.capturePage();
  fs.writeFileSync(path.join(assets, 'social-preview.png'), preview.resize({ width: 1280, height: 640 }).toPNG());
  console.log('Icons written to assets/: icon.icns, icon.ico, icon.png, social-preview.png');
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });

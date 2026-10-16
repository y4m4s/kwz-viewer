import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';

// Render the original SVG artwork shared by the web and desktop app icons.
const svg = await readFile('apps/web/public/images/icon.svg', 'utf8');
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' });
try {
  const sizes = [16, 32, 48, 64, 128, 256];
  const frames = [];
  for (const size of sizes) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:100vw;height:100vh}</style>${svg}`);
    frames.push(await page.screenshot({ omitBackground: true }));
    await page.close();
  }
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((size, i) => {
    const pos = 6 + i * 16;
    header[pos] = size === 256 ? 0 : size; header[pos + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, pos + 4); header.writeUInt16LE(32, pos + 6);
    header.writeUInt32LE(frames[i].length, pos + 8); header.writeUInt32LE(offset, pos + 12);
    offset += frames[i].length;
  });
  const ico = Buffer.concat([header, ...frames]);
  await writeFile('apps/web/public/favicon.ico', ico);
  await writeFile('src-tauri/icons/icon.ico', ico);
  console.log(`favicon.ico / Tauri icon.ico: ${sizes.join(', ')}px from icon.svg`);
} finally { await browser.close(); }

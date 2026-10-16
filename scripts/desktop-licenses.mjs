import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
// beforeBuildCommand runs before Cargo builds; populate sources on a clean checkout.
const fetched = spawnSync('cargo', ['fetch', '--locked', '--manifest-path', path.join(root, 'src-tauri/Cargo.toml'), ...(process.platform === 'win32' ? ['--target', 'x86_64-pc-windows-msvc'] : [])], { stdio: 'inherit', windowsHide: true });
if (fetched.error || fetched.status !== 0) throw fetched.error || new Error('Rust dependency download failed');
const sections = ['Third-party notices for kwz viewer\nGenerated from installed dependency sources.\nRust crates are unmodified; the source download URLs below provide the corresponding original source.\n'];
async function collect(directory, label) {
  const files = (await fs.readdir(directory)).filter(name => /^(licen[cs]e|copying|notice)([.-]|$)/i.test(name));
  let count = 0;
  for (const name of files.sort()) {
    const file = path.join(directory, name);
    if ((await fs.stat(file)).isFile()) {
      sections.push(`\n${'='.repeat(72)}\n${label} — ${name}\n\n${await fs.readFile(file, 'utf8')}`);
      count++;
    }
  }
  return count;
}
for (const name of ['react', 'react-dom', 'scheduler', 'flipnote.js', '@tauri-apps/api']) {
  const directory = path.join(root, 'node_modules', name);
  const pkg = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'));
  if (!await collect(directory, `${name} ${pkg.version}`)) throw new Error(`Missing license: ${name}`);
}
const target = process.platform === 'win32' ? ['--target', 'x86_64-pc-windows-msvc'] : [];
const tree = spawnSync('cargo', ['tree', '--locked', '--offline', '--manifest-path', path.join(root, 'src-tauri/Cargo.toml'), ...target, '--prefix', 'none', '--format', '{p}', '--edges', 'normal,build'], { encoding: 'utf8', windowsHide: true });
if (tree.error || tree.status !== 0) throw tree.error || new Error(tree.stderr);
const packages = new Map([...tree.stdout.matchAll(/^([^\s]+) v([^\s]+).*$/gm)].filter(match => match[1] !== 'kwz-viewer').map(match => [`${match[1]}-${match[2]}`, { name: match[1], version: match[2] }]));
// These published crates omit their license files. Keep exact-version upstream copies.
const overrides = JSON.parse(await fs.readFile(path.join(root, 'scripts/license-overrides/sources.json'), 'utf8'));
const cargoHome = process.env.CARGO_HOME || path.join(os.homedir(), '.cargo');
const found = new Set();
for (const registry of await fs.readdir(path.join(cargoHome, 'registry/src'))) {
  const directory = path.join(cargoHome, 'registry/src', registry);
  for (const crate of (await fs.readdir(directory)).filter(name => packages.has(name)).sort()) {
    if (found.has(crate)) continue;
    const { name, version } = packages.get(crate);
    sections.push(`\n${crate}\nSource (unmodified): https://crates.io/api/v1/crates/${name}/${version}/download\n`);
    if (!await collect(path.join(directory, crate), crate)) {
      const fallback = overrides[crate];
      if (!fallback) throw new Error(`Missing license: ${crate}. Add a reviewed upstream license before distributing.`);
      sections.push(`\n${crate} — ${fallback.file}\nLicense source: ${fallback.source}\n\n${await fs.readFile(path.join(root, 'scripts/license-overrides', fallback.file), 'utf8')}`);
    }
    found.add(crate);
  }
}
const missing = [...packages.keys()].filter(name => !found.has(name));
if (missing.length) throw new Error(`Missing dependency sources: ${missing.join(', ')}`);
const rustc = spawnSync('rustc', ['--print', 'sysroot'], { encoding: 'utf8', windowsHide: true });
if (rustc.error || rustc.status !== 0) throw rustc.error || new Error(rustc.stderr);
const rustDocs = path.join(rustc.stdout.trim(), 'share/doc/rust');
const rustNotices = path.join(root, 'apps/web/public/licenses/rust');
await fs.mkdir(rustNotices, { recursive: true });
await fs.copyFile(path.join(rustDocs, 'COPYRIGHT-library.html'), path.join(rustNotices, 'COPYRIGHT-library.html'));
await fs.cp(path.join(rustDocs, 'licenses'), path.join(rustNotices, 'licenses'), { recursive: true });
if (!packages.has('webview2-com-sys-0.39.1')) throw new Error('Review the WebView2 SDK version and license notices after updating webview2-com-sys.');
for (const file of ['WebView2-SDK.txt', 'WebView2-SDK-NOTICE.txt']) {
  sections.push(`\nWebView2 SDK 1.0.3650.58 — ${file}\nSource: https://www.nuget.org/packages/Microsoft.Web.WebView2/1.0.3650.58\n\n${await fs.readFile(path.join(root, 'scripts/license-overrides', file), 'utf8')}`);
}
const destination = path.join(root, 'apps/web/public/licenses/third-party-desktop.txt');
await fs.writeFile(destination, sections.join('\n'), 'utf8');
console.log(`Desktop dependency notices generated (${found.size} Rust crates, npm notices and Rust standard-library notices).`);

import { existsSync } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const env = { ...process.env };
const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') || 'PATH';
const localToolchain = path.join(root, '.app-data/toolchain');
const cargoName = process.platform === 'win32' ? 'cargo.exe' : 'cargo';
const userCargoBin = path.join(env.CARGO_HOME || path.join(homedir(), '.cargo'), 'bin');
const localCargoBin = path.join(localToolchain, 'cargo/bin');
const cargoBin = existsSync(path.join(userCargoBin, cargoName)) ? userCargoBin
  : !env.CARGO_HOME && !env.RUSTUP_HOME && existsSync(path.join(localCargoBin, cargoName)) ? localCargoBin
  : undefined;
if (cargoBin === localCargoBin) {
  env.CARGO_HOME = path.join(localToolchain, 'cargo');
  env.RUSTUP_HOME = path.join(localToolchain, 'rustup');
}
if (cargoBin) {
  env[pathKey] = `${cargoBin}${path.delimiter}${env[pathKey] || ''}`;
}
const mode = process.argv[2] || 'dev';
const cargoModes = { check: ['check', '--locked'], test: ['test', '--locked'], fmt: ['fmt', '--check'], lint: ['clippy', '--locked', '--all-targets'] };
const cargo = cargoModes[mode];
const command = cargo ? (cargoBin ? path.join(cargoBin, cargoName) : 'cargo') : process.execPath;
const args = cargo ? [...cargo, '--manifest-path', path.join(root, 'src-tauri/Cargo.toml'), ...(mode === 'lint' ? ['--', '-D', 'warnings'] : [])] : [path.join(root, 'node_modules/@tauri-apps/cli/tauri.js'), mode, ...process.argv.slice(3)];
const child = spawn(command, args, { cwd: root, env, stdio: 'inherit', windowsHide: true });
child.on('error', error => { console.error(`デスクトップビルドを起動できません: ${error.message}`); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });

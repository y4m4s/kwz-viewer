import { mkdir, readFile, writeFile, rename, rm, access, realpath } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { inside } from './file-scanner.js';

export class SettingsInsideLibrary extends Error {}
export async function checkSettingsLocation(file: string, directory: string) {
  const parent = path.dirname(path.resolve(file));
  let ancestor = parent;
  while (true) {
    try { await access(ancestor); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const next = path.dirname(ancestor); if (next === ancestor) throw error;
      ancestor = next;
    }
  }
  const physical = path.resolve(await realpath(ancestor), path.relative(ancestor, parent));
  if (physical === directory || inside(directory, physical))
    throw new SettingsInsideLibrary('アプリの内部設定を含むフォルダは選択できません。KWZの保存先フォルダを選択してください。');
}

export async function loadDirectory(file: string): Promise<string | undefined> {
  try {
    const settings = JSON.parse(await readFile(file, 'utf8'));
    return settings && typeof settings === 'object' && typeof settings.directory === 'string' && path.isAbsolute(settings.directory) ? settings.directory : undefined;
  } catch (error) {
    if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

export async function saveDirectory(file: string, directory: string) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify({ directory }), 'utf8');
    await rename(temporary, file);
  } finally { await rm(temporary, { force: true }); }
}

let preparedPicker: Promise<string> | undefined;
export function prepareFolderPicker(): Promise<string> {
  return preparedPicker ??= buildFolderPicker().catch(error => { preparedPicker = undefined; throw error; });
}

async function buildFolderPicker(): Promise<string> {
  if (process.platform !== 'win32') throw new Error('Folder picker currently requires Windows');
  const source = path.resolve('apps/server/native/folder-picker.cs');
  const hash = createHash('sha256').update(await readFile(source)).digest('hex').slice(0, 16);
  const executable = path.resolve('.app-data/native', `folder-picker-${hash}.exe`);
  try { await access(executable); return executable; } catch { /* Build once per source revision. */ }
  await mkdir(path.dirname(executable), { recursive: true });
  const temporary = `${executable}.${randomUUID()}.exe`;
  const compiler = path.join(process.env.SystemRoot || 'C:/Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  try {
    await promisify(execFile)(compiler, ['/nologo', '/target:exe', '/optimize+', `/out:${temporary}`, source], { windowsHide: true });
    await rename(temporary, executable);
  } finally { await rm(temporary, { force: true }); }
  return executable;
}

// Kept separate from settings/indexing so a desktop shell can supply its own picker.
export async function pickDirectory(currentDirectory?: string, signal?: AbortSignal): Promise<string | null> {
  const executable = await prepareFolderPicker();
  const { stdout } = await promisify(execFile)(executable, currentDirectory ? [currentDirectory] : [], {
    windowsHide: true, encoding: 'utf8', maxBuffer: 64 * 1024, signal,
  });
  return stdout.trim() || null;
}

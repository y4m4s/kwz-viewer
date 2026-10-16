import chokidar from 'chokidar';
import path from 'node:path';
import type { NoteIndex } from './note-index.js';

export function watchLibrary(index: NoteIndex) {
  const directory = index.config.directory;
  if (!directory) return { close: async () => {} };
  let pending = false; let running = false; let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  async function drain() {
    if (running || closed) return;
    running = true;
    try {
      while (pending && !closed) {
        // If another scan was already running, process the new changes after it finishes.
        await index.waitForScan();
        if (closed) break;
        pending = false; await index.rescan();
      }
    } finally { running = false; }
  }
  const watcher = chokidar.watch(path.resolve(directory), {
    persistent: true, ignoreInitial: true, followSymlinks: false,
    depth: index.config.recursive ? undefined : 0,
    awaitWriteFinish: { stabilityThreshold: 700, pollInterval: 100 },
  });
  const schedule = () => {
    pending = true; clearTimeout(timer); timer = setTimeout(() => { void drain(); }, 200);
  };
  watcher.on('all', (event, file) => {
    if (event === 'unlinkDir' || event === 'addDir' || /\.kwz$/i.test(file)) schedule();
  });
  watcher.on('error', () => { index.status.message = 'フォルダ監視に失敗しました。アクセス権を確認してアプリを再起動してください。'; });
  return { ready: new Promise<void>(resolve => watcher.once('ready', resolve)), close: async () => {
    closed = true; clearTimeout(timer); await watcher.close(); await index.waitForScan();
  } };
}

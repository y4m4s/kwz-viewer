import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { createDefaultConfig } from '../apps/server/src/config';
import { validateRoot, scanFiles } from '../apps/server/src/services/file-scanner';
import { NoteIndex } from '../apps/server/src/services/note-index';
import { thumbnailMime } from '../apps/server/src/services/kwz-service';
import { PNG } from 'pngjs';
import { loadDirectory } from '../apps/server/src/services/library-settings';
const config = createDefaultConfig();
config.directory = await loadDirectory(config.settingsFile!);
if (!config.directory) throw new Error('アプリの「フォルダ選択」からフォルダを選択してください');
const root = await validateRoot(config.directory);
const files = await scanFiles(root, config.recursive);
async function fingerprint(relativePath: string) {
  const file = path.join(root, relativePath);
  return { hash: createHash('sha256').update(await readFile(file)).digest('hex'), mtimeMs: (await stat(file)).mtimeMs };
}
const before = new Map<string, Awaited<ReturnType<typeof fingerprint>>>();
for (const file of files) before.set(file.id, await fingerprint(file.relativePath));
const index = new NoteIndex(config); await index.rescan();
let pngThumbnails = 0; let jpegThumbnails = 0; let fullResolution = 0;
for (const entry of index.entries.values()) {
  if (!entry.thumbnail) continue;
  if (thumbnailMime(entry.thumbnail) === 'image/png') {
    pngThumbnails++; const image = PNG.sync.read(entry.thumbnail);
    if (image.width === 320 && image.height === 240) fullResolution++;
  } else if (thumbnailMime(entry.thumbnail) === 'image/jpeg') jpegThumbnails++;
}
let unchanged = 0;
for (const file of files) {
  const after = await fingerprint(file.relativePath); const prior = before.get(file.id)!;
  if (after.hash === prior.hash && after.mtimeMs === prior.mtimeMs) unchanged++;
}
console.log(JSON.stringify({ ...index.status, pngThumbnails, jpegThumbnails, fullResolution, originalsUnchanged: unchanged }, null, 2));
if (index.status.scanStatus !== 'ready' || unchanged !== files.length) process.exitCode = 1;

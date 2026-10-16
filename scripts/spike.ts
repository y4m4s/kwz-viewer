import { parse, FlipnoteFormat, version } from 'flipnote.js';
import { readFile, readdir, stat, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { thumbnailJpeg } from '../apps/server/src/services/kwz-service';
import { loadDirectory } from '../apps/server/src/services/library-settings';

async function files(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...await files(p));
    else if (entry.isFile() && /\.kwz$/i.test(entry.name)) results.push(p);
  }
  return results;
}
const root = await loadDirectory('.app-data/settings.json');
if (!root) throw new Error('アプリの「フォルダ選択」からフォルダを選択してください');
const candidates = await files(root);
await mkdir('.app-data/spike', { recursive: true });
console.log(`flipnote.js ${version}: ${candidates.length} KWZ files`);
for (const [i, file] of candidates.slice(0, 3).entries()) {
  const before = await stat(file);
  const bytes = await readFile(file);
  const hash = createHash('sha256').update(bytes).digest('hex');
  const note = await parse(bytes);
  if (note.format !== FlipnoteFormat.KWZ) throw new Error('Not KWZ');
  const jpeg = note.getThumbnailImage();
  const thumbnail = thumbnailJpeg(note);
  if (!thumbnail) throw new Error('No JPEG');
  await writeFile(`.app-data/spike/${i}.jpg`, thumbnail);
  note.getFramePixels(0);
  const pcm = note.getAudioMasterPcm();
  const after = await stat(file);
  console.log(JSON.stringify({ file: path.relative(root, file), author: note.meta.current.username,
    frames: note.frameCount, duration: note.duration, thumbnail: [jpeg.width, jpeg.height],
    pcmSamples: pcm.length, nonSilent: pcm.some(v => v !== 0),
    unchanged: before.mtimeMs === after.mtimeMs && hash === createHash('sha256').update(await readFile(file)).digest('hex') }));
}

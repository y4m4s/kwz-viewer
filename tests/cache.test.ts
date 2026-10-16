import { test, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, writeFile, rm, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { NoteIndex } from '../apps/server/src/services/note-index';
import { ThumbnailCache } from '../apps/server/src/services/thumbnail-cache';
let temp: string;
beforeEach(async () => { await mkdir('.app-data/tests', { recursive: true }); temp = await mkdtemp(path.resolve('.app-data/tests/cache-')); await mkdir(path.join(temp, 'notes')); });
afterEach(async () => { await rm(temp, { recursive: true, force: true }); });

test('failed cache writes do not leave temporary files behind', async () => {
  const base = path.join(temp, 'cache');
  const cache = new ThumbnailCache(base); await cache.load(path.join(temp, 'notes'));
  const folder = path.join(base, (await readdir(base))[0]);
  await mkdir(path.join(folder, 'index.json'));
  await expect(cache.save([])).rejects.toThrow();
  expect(await readdir(folder)).toEqual(['index.json']);
});
test('persistent cache reuses unchanged files, reparses changes and invalid cache, removes deleted notes', async () => {
  const root = path.join(temp, 'notes'); const cache = path.join(temp, 'cache');
  const config = { directory: root, recursive: true, port: 4173, maxBytes: 10000, cacheDirectory: cache };
  let calls = 0;
  const inspect = async () => { calls++; return { metadata: { author: 'Author', createdAt: null, editedAt: null, frameCount: 12, durationSeconds: 1, loop: false }, thumbnail: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) }; };
  await writeFile(path.join(root, 'a.kwz'), 'hello');
  const first = new NoteIndex(config, inspect); await first.rescan(); expect(calls).toBe(1);
  const second = new NoteIndex(config, inspect); await second.rescan(); expect(calls).toBe(1);
  expect(second.status.scanStatus).toBe('ready');
  await writeFile(path.join(root, 'a.kwz'), 'changed-size'); await second.rescan(); expect(calls).toBe(2);
  const folder = path.join(cache, (await readdir(cache))[0]);
  const document = JSON.parse(await readFile(path.join(folder, 'index.json'), 'utf8'));
  await rm(path.join(folder, document.records[0].thumbnailFile));
  await second.rescan(); expect(calls).toBe(3);
  await writeFile(path.join(folder, 'index.json'), '{broken'); await second.rescan(); expect(calls).toBe(4);
  await rm(path.join(root, 'a.kwz')); await second.rescan(); expect(second.status.total).toBe(0);
  expect(JSON.parse(await readFile(path.join(folder, 'index.json'), 'utf8')).records).toHaveLength(0);
});
test('cache inside originals is disabled without writing into originals', async () => {
  const root = path.join(temp, 'notes');
  const index = new NoteIndex({ directory: root, recursive: true, port: 4173, maxBytes: 10000, cacheDirectory: path.join(root, 'cache') });
  await index.rescan(); expect(index.status.scanStatus).toBe('ready'); expect(index.status.message).toContain('キャッシュ');
  expect(await readdir(root)).toEqual([]);
});

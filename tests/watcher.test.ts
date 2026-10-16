import { test, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { NoteIndex } from '../apps/server/src/services/note-index';
import { watchLibrary } from '../apps/server/src/services/library-watcher';
test('watcher reflects stable add/change/delete and shuts down', async () => {
  await mkdir('.app-data/tests', { recursive: true });
  const root = await mkdtemp(path.resolve('.app-data/tests/watch-'));
  let calls = 0;
  const index = new NoteIndex({ directory: root, recursive: true, port: 4173, maxBytes: 1000 }, async () => {
    calls++; return { metadata: { author: 'Author', createdAt: null, editedAt: null, frameCount: 1, durationSeconds: 1, loop: false }, thumbnail: null };
  });
  await index.rescan();
  const watcher = watchLibrary(index);
  try {
    await watcher.ready;
    const file = path.join(root, 'new.KWZ');
    await writeFile(file, 'part1'); await new Promise(resolve => setTimeout(resolve, 200));
    expect(calls).toBe(0); // Copying is not yet stable.
    await writeFile(file, 'part1 part2');
    await expect.poll(() => index.status.total, { timeout: 6000 }).toBe(1);
    await expect.poll(() => index.status.scanStatus).toBe('ready');
    expect([...index.entries.values()][0].note.byteSize).toBe(11);
    const previous = calls; await writeFile(file, 'changed');
    await expect.poll(() => calls, { timeout: 6000 }).toBeGreaterThan(previous);
    await rm(file); await expect.poll(() => index.status.total, { timeout: 6000 }).toBe(0);
  } finally { await watcher.close(); await rm(root, { recursive: true, force: true }); }
});

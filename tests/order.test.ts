import { beforeEach, afterEach, test, expect, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { NoteIndex } from '../apps/server/src/services/note-index';
import { createApp } from '../apps/server/src/app';
import type { Config } from '../apps/server/src/config';
import { NoteOrder } from '../apps/server/src/services/note-order';
let temp: string; let config: Config;
const inspect = async () => ({ metadata: { author: 'Author', createdAt: null, editedAt: null, frameCount: 1, durationSeconds: 1, loop: false }, thumbnail: null });
beforeEach(async () => {
  await mkdir('.app-data/tests', { recursive: true }); temp = await mkdtemp(path.resolve('.app-data/tests/order-'));
  const directory = path.join(temp, 'notes'); await mkdir(path.join(directory, 'folder'), { recursive: true });
  for (const name of ['a', 'b', 'c']) await writeFile(path.join(directory, 'folder', `${name}.kwz`), name);
  await mkdir(path.join(directory, 'other')); await writeFile(path.join(directory, 'other/x.kwz'), 'x');
  config = { directory, recursive: true, port: 4173, maxBytes: 1000, orderDirectory: path.join(temp, 'orders') };
});
afterEach(async () => { await rm(temp, { recursive: true, force: true }); });
const query = { page: 1, pageSize: 100, folder: 'folder' };

test('a null order document can be repaired by the next successful move', async () => {
  const index = new NoteIndex(config, inspect); await index.rescan();
  const [a, b] = index.list(query).items;
  await index.move({ folder: 'folder', sourceId: a.id, targetId: b.id, placement: 'after' });
  const file = path.join(config.orderDirectory!, (await readdir(config.orderDirectory!))[0]);
  await writeFile(file, 'null');
  const fresh = new NoteIndex(config, inspect); await fresh.rescan();
  expect(fresh.status.message).toContain('並び順');
  await fresh.move({ folder: 'folder', sourceId: a.id, targetId: b.id, placement: 'after' });
  expect(JSON.parse(await readFile(file, 'utf8')).version).toBe(1);
});

test('switching libraries waits for an outstanding order save and rejects new moves', async () => {
  const index = new NoteIndex(config, inspect); await index.rescan();
  const [a, b] = index.list(query).items;
  const nextDirectory = path.join(temp, 'next'); await mkdir(nextDirectory);
  await writeFile(path.join(nextDirectory, 'new.kwz'), 'new');
  let release!: () => void; let started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const saving = new Promise<void>(resolve => { started = resolve; });
  const originalSave = NoteOrder.prototype.save;
  const spy = vi.spyOn(NoteOrder.prototype, 'save').mockImplementationOnce(async function (this: NoteOrder, root, folder, ids) {
    started(); await gate; return originalSave.call(this, root, folder, ids);
  });
  try {
    const move = index.move({ folder: 'folder', sourceId: a.id, targetId: b.id, placement: 'after' });
    await saving;
    const change = index.changeDirectory(nextDirectory);
    await expect(index.move({ folder: 'folder', sourceId: a.id, targetId: b.id, placement: 'after' })).rejects.toThrow('切り替え中');
    expect(index.config.directory).toBe(config.directory);
    release(); await move; await change; await index.waitForIdle();
    expect(index.list({ page: 1, pageSize: 6 }).items.map(n => n.fileName)).toEqual(['new.kwz']);
    const restored = new NoteIndex({ ...config, directory: path.join(temp, 'notes') }, inspect); await restored.rescan();
    expect(restored.list(query).items.findIndex(n => n.id === a.id)).toBe(restored.list(query).items.findIndex(n => n.id === b.id) + 1);
  } finally { release(); spy.mockRestore(); await index.waitForIdle(); }
});
test('saved moves survive a fresh index, rescans and new/deleted files without modifying originals', async () => {
  const index = new NoteIndex(config, inspect); await index.rescan();
  const originals = index.list(query).items;
  const before = await Promise.all(originals.map(async n => ({ content: await readFile(path.join(config.directory!, n.relativePath), 'utf8'), mtime: (await stat(path.join(config.directory!, n.relativePath))).mtimeMs })));
  const [a, b, c] = originals;
  await index.move({ folder: 'folder', sourceId: c.id, targetId: a.id, placement: 'before' });
  expect(index.list(query).items.map(n => n.id)).toEqual([c.id, a.id, b.id]);
  const restarted = new NoteIndex(config, inspect); await restarted.rescan();
  expect(restarted.list(query).items.map(n => n.id)).toEqual([c.id, a.id, b.id]);
  await restarted.move({ folder: 'folder', sourceId: c.id, targetId: b.id, placement: 'after' });
  expect(restarted.list(query).items.map(n => n.id)).toEqual([a.id, b.id, c.id]);
  for (const [i, n] of originals.entries()) {
    expect(await readFile(path.join(config.directory!, n.relativePath), 'utf8')).toBe(before[i].content);
    expect((await stat(path.join(config.directory!, n.relativePath))).mtimeMs).toBe(before[i].mtime);
  }
  await writeFile(path.join(config.directory!, 'folder/new.kwz'), 'new'); await restarted.rescan();
  expect(restarted.list(query).items.map(n => n.id).slice(0, 3)).toEqual([a.id, b.id, c.id]);
  expect(restarted.list(query).items.at(-1)?.fileName).toBe('new.kwz');
  await rm(path.join(config.directory!, c.relativePath)); await restarted.rescan();
  expect(restarted.list(query).items.map(n => n.id).slice(0, 2)).toEqual([a.id, b.id]);
});
test('move API validates IDs, folder membership and origin; concurrent saves are serialized', async () => {
  const index = new NoteIndex(config, inspect); await index.rescan();
  const [a, b, c] = index.list(query).items;
  const { app } = await createApp(config, index);
  try {
    const command = { folder: 'folder', sourceId: a.id, targetId: b.id, placement: 'after' };
    const post = (body: unknown, origin = 'http://127.0.0.1:4173') => app.inject({ method: 'POST', url: '/api/notes/order', headers: { host: '127.0.0.1:4173', origin, 'content-type': 'application/json' }, payload: JSON.stringify(body) });
    expect((await post({ ...command, sourceId: 'bad' })).statusCode).toBe(400);
    expect((await post({ ...command, folder: '../outside' })).statusCode).toBe(400);
    const foreign = index.list({ ...query, folder: 'other' }).items[0];
    expect((await post({ ...command, targetId: foreign.id })).statusCode).toBe(400);
    expect((await post(command, 'https://evil.example')).statusCode).toBe(403);
    const replies = await Promise.all([post(command), post({ ...command, sourceId: c.id, targetId: b.id, placement: 'before' })]);
    expect(replies.map(r => r.statusCode)).toEqual([200, 200]);
    expect(index.list(query).items.map(n => n.id)).toEqual([c.id, b.id, a.id]);
    const fresh = new NoteIndex(config, inspect); await fresh.rescan(); expect(fresh.list(query).items.map(n => n.id)).toEqual([c.id, b.id, a.id]);
  } finally { await app.close(); }
});
test('invalid stored JSON recovers, and order storage inside originals is refused', async () => {
  const index = new NoteIndex(config, inspect); await index.rescan(); const [a, b] = index.list(query).items;
  await index.move({ folder: 'folder', sourceId: a.id, targetId: b.id, placement: 'after' });
  await writeFile(path.join(config.orderDirectory!, (await readdir(config.orderDirectory!))[0]), '{broken');
  const fresh = new NoteIndex(config, inspect); await fresh.rescan(); expect(fresh.status.scanStatus).toBe('ready'); expect(fresh.status.message).toContain('並び順');
  const unsafe = new NoteIndex({ ...config, orderDirectory: path.join(config.directory!, 'orders') }, inspect); await unsafe.rescan();
  const initial = unsafe.list(query).items.map(n => n.id);
  await expect(unsafe.move({ folder: 'folder', sourceId: a.id, targetId: b.id, placement: 'after' })).rejects.toThrow();
  expect(unsafe.list(query).items.map(n => n.id)).toEqual(initial);
  expect(await readdir(config.directory!)).not.toContain('orders');
});

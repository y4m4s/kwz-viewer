import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, readFile, stat, symlink } from 'node:fs/promises';
import path from 'node:path';
import { createApp } from '../apps/server/src/app';
import { NoteIndex } from '../apps/server/src/services/note-index';
import { scanFiles, readSafe, validateRoot, inside } from '../apps/server/src/services/file-scanner';
import { inspectKwz, isoDate } from '../apps/server/src/services/kwz-service';

let root: string;
beforeEach(async () => { await mkdir('.app-data/tests', { recursive: true }); root = await mkdtemp(path.resolve('.app-data/tests/kwz-viewer-test-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
const config = () => ({ directory: root, recursive: true, port: 4173, maxBytes: 10000 });
const mockInspector = async (bytes: Buffer) => {
  if (bytes.toString() === 'broken') throw new Error('broken');
  return { metadata: { author: 'Cat Author', createdAt: bytes.toString() === 'null' ? null : '2020-01-01T00:00:00.000Z', editedAt: null,
    frameCount: 12, durationSeconds: 1, loop: false }, thumbnail: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) };
};
const localHeaders = { host: '127.0.0.1:4173' };
describe('scanner and safety', () => {
  test('case-insensitive extension, recursion and path-derived unique IDs', async () => {
    await mkdir(path.join(root, 'sub')); await writeFile(path.join(root, 'same.KWZ'), 'a');
    await writeFile(path.join(root, 'sub/same.kwz'), 'a'); await writeFile(path.join(root, 'other.txt'), 'a');
    expect(await scanFiles(root, false)).toHaveLength(1);
    const items = await scanFiles(root, true); expect(items).toHaveLength(2);
    expect(new Set(items.map(i => i.id)).size).toBe(2);
    expect(inside(root, path.join(root, '../escape'))).toBe(false);
    expect(inside(root, path.join(root, 'sub/same.kwz'))).toBe(true);
  });
  test('size limit and traversal reject without changing originals', async () => {
    const file = path.join(root, 'sample.kwz'); await writeFile(file, 'hello');
    const before = await stat(file); const item = (await scanFiles(root, true))[0];
    expect((await readSafe(root, item, 10)).toString()).toBe('hello');
    await expect(readSafe(root, item, 4)).rejects.toThrow();
    await expect(readSafe(root, { ...item, relativePath: '../escape.kwz' }, 10)).rejects.toThrow();
    expect((await stat(file)).mtimeMs).toBe(before.mtimeMs); expect(await readFile(file, 'utf8')).toBe('hello');
  });
  test('junctions are skipped and replacement of an indexed directory is rejected', async () => {
    const outside = await mkdtemp(path.resolve('.app-data/tests/kwz-outside-'));
    try {
      await writeFile(path.join(outside, 'sample.kwz'), 'private');
      await symlink(outside, path.join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
      expect(await scanFiles(root, true)).toHaveLength(0);
      await mkdir(path.join(root, 'sub')); await writeFile(path.join(root, 'sub/sample.kwz'), 'safe');
      const item = (await scanFiles(root, true))[0];
      await rm(path.join(root, 'sub'), { recursive: true });
      await symlink(outside, path.join(root, 'sub'), process.platform === 'win32' ? 'junction' : 'dir');
      await expect(readSafe(await validateRoot(root), item, 100)).rejects.toThrow();
    } finally { await rm(outside, { recursive: true, force: true }); }
  });
});
describe('index and API (mock metadata, not playback evidence)', () => {
  test('folder navigation includes descendants and separates similar path prefixes', async () => {
    await mkdir(path.join(root, 'one/nested'), { recursive: true });
    await mkdir(path.join(root, 'one-other'));
    await writeFile(path.join(root, 'one/nested/a.kwz'), 'ok');
    await writeFile(path.join(root, 'one/b.kwz'), 'ok');
    await writeFile(path.join(root, 'one-other/c.kwz'), 'ok');
    const index = new NoteIndex(config(), mockInspector); await index.rescan();
    expect(index.folders()).toContainEqual({ path: 'one', count: 2 });
    expect(index.folders()).toContainEqual({ path: 'one/nested', count: 1 });
    const { app } = await createApp(config(), index);
    try {
      const folders = await app.inject({ url: '/api/folders', headers: localHeaders });
      expect(folders.json()).toEqual(index.folders());
      const notes = await app.inject({ url: '/api/notes?folder=one&pageSize=6', headers: localHeaders });
      expect(notes.json().total).toBe(2);
      expect((await app.inject({ url: '/api/notes?folder=../outside', headers: localHeaders })).json().total).toBe(0);
    } finally { await app.close(); }
  });
  test('isolates corrupt files and pages; add/delete automatic scan updates', async () => {
    await writeFile(path.join(root, 'a.kwz'), 'ok'); await writeFile(path.join(root, 'b.kwz'), 'broken');
    await writeFile(path.join(root, 'c.kwz'), 'null');
    const index = new NoteIndex(config(), mockInspector);
    const job = index.rescan(); expect(index.rescan()).toBe(job); await job;
    expect(index.status).toMatchObject({ scanStatus: 'ready', total: 3, indexed: 3, failed: 1 });
    const query = { page: 1, pageSize: 1 };
    expect(index.list(query).total).toBe(3);
    expect([1, 2, 3].map(page => index.list({ ...query, page }).items[0].fileName).sort()).toEqual(['a.kwz', 'b.kwz', 'c.kwz']);
    await rm(path.join(root, 'a.kwz')); await writeFile(path.join(root, 'new.kwz'), 'ok'); await index.rescan();
    expect([...index.entries.values()].map(e => e.note.fileName)).toEqual(['b.kwz', 'c.kwz', 'new.kwz']);
  });
  test('routes, input validation, security headers and predictable errors', async () => {
    await writeFile(path.join(root, 'a.kwz'), 'ok');
    const index = new NoteIndex(config(), mockInspector); await index.rescan();
    const { app } = await createApp(config(), index);
    try {
      const get = (url: string) => app.inject({ url, headers: localHeaders });
      const response = await get('/api/notes'); expect(response.statusCode).toBe(200);
      const id = response.json().items[0].id;
      expect((await get(`/api/notes/${id}`)).statusCode).toBe(200);
      const thumbnail = await get(`/api/notes/${id}/thumbnail`); expect(thumbnail.headers['content-type']).toBe('image/jpeg');
      expect((await get(`/api/notes/${id}/file`)).body).toBe('ok');
      expect((await get('/api/notes/missing/file')).statusCode).toBe(404);
      for (const q of ['page=0', 'pageSize=101', 'sort=evil', 'order=wrong', 'page=1.2', 'unknown=1', 'q=removed'])
        expect((await get(`/api/notes?${q}`)).statusCode).toBe(400);
      expect((await app.inject({ url: '/api/health', headers: { host: 'evil.example:4173' } })).statusCode).toBe(403);
      expect((await app.inject({ method: 'POST', url: '/api/rescan', headers: { ...localHeaders, origin: 'https://evil.example' } })).statusCode).toBe(403);
      expect((await app.inject({ method: 'POST', url: '/api/rescan', headers: { ...localHeaders, origin: 'http://127.0.0.1:5173' } })).statusCode).toBe(403);
      expect((await app.inject({ method: 'POST', url: '/api/rescan', headers: { ...localHeaders, origin: 'http://127.0.0.1:4173' } })).statusCode).toBe(404);
      await index.rescan();
      await rm(path.join(root, 'a.kwz'));
      expect((await get(`/api/notes/${id}/file`)).statusCode).toBe(409);
    } finally { await app.close(); }
  });
  test('unset, missing and empty directory are distinct from corrupt files', async () => {
    const unset = new NoteIndex({ ...config(), directory: undefined }); await unset.rescan();
    expect(unset.status).toMatchObject({ scanStatus: 'error', directoryConfigured: false });
    const missing = new NoteIndex({ ...config(), directory: path.join(root, 'missing') }); await missing.rescan();
    expect(missing.status).toMatchObject({ scanStatus: 'error', directoryConfigured: true });
    const empty = new NoteIndex(config()); await empty.rescan(); expect(empty.status).toMatchObject({ scanStatus: 'ready', total: 0 });
    await writeFile(path.join(root, 'broken.kwz'), 'not kwz'); await empty.rescan();
    expect([...empty.entries.values()][0].note.errorCode).toBe('INVALID_KWZ');
  });
});
test('Vite origin is allowed only in explicit development mode', async () => {
  const { app } = await createApp({ ...config(), development: true });
  try {
    expect((await app.inject({ url: '/api/health', headers: { ...localHeaders, origin: 'http://127.0.0.1:5173' } })).statusCode).toBe(200);
  } finally { await app.close(); }
});
test('dates and actual invalid KWZ', async () => {
  expect(isoDate(new Date('invalid'))).toBeNull();
  expect(isoDate(new Date('2020-01-01Z'))).toBe('2020-01-01T00:00:00.000Z');
  await expect(inspectKwz(Buffer.from('broken'))).rejects.toBeDefined();
});

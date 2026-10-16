import { test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createApp } from '../apps/server/src/app';
import { loadDirectory } from '../apps/server/src/services/library-settings';

let root: string;
beforeEach(async () => {
  await mkdir('.app-data/tests', { recursive: true });
  root = await mkdtemp(path.resolve('.app-data/tests/settings-'));
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
const config = () => ({ recursive: true, port: 4173, maxBytes: 10000, settingsFile: path.join(root, 'settings.json'), watch: false });
const request = { method: 'POST' as const, url: '/api/library/select', headers: { host: '127.0.0.1:4173' }, payload: {} };

test('selection is indexed and restored after restart without env configuration', async () => {
  const directory = path.join(root, 'library'); await mkdir(directory);
  await writeFile(path.join(directory, 'broken.kwz'), 'broken');
  const { app, index } = await createApp(config(), undefined, async () => directory);
  try {
    const response = await app.inject(request);
    expect(response.statusCode).toBe(200);
    expect(response.json().cancelled).toBe(false);
    await index.waitForScan();
    expect(index.status.directoryConfigured).toBe(true);
    expect(index.status.total).toBe(1);
    expect(await loadDirectory(config().settingsFile)).toBe(await realpath(directory));
  } finally { await app.close(); }
  let pickerCalls = 0;
  const restarted = await createApp(config(), undefined, async () => { pickerCalls++; return null; });
  try {
    expect(restarted.index.config.directory).toBe(await loadDirectory(config().settingsFile));
    await restarted.index.rescan();
    expect(restarted.index.status.total).toBe(1);
    const health = await restarted.app.inject({ url: '/api/health', headers: request.headers });
    expect(health.json().directory).toBe(await realpath(directory));
    expect(pickerCalls).toBe(0);
  }
  finally { await restarted.app.close(); }
});

test('cancellation, invalid selection and untrusted origins do not save settings', async () => {
  let selection: string | null = null; let calls = 0;
  const { app, index } = await createApp(config(), undefined, async () => { calls++; return selection; });
  try {
    expect((await app.inject(request)).json()).toEqual({ cancelled: true });
    selection = path.join(root, 'missing');
    expect((await app.inject(request)).statusCode).toBe(503);
    expect(index.status.directoryConfigured).toBe(false);
    expect(await loadDirectory(config().settingsFile)).toBeUndefined();
    const before = calls;
    expect((await app.inject({ ...request, headers: { ...request.headers, origin: 'https://example.com' } })).statusCode).toBe(403);
    expect((await app.inject({ ...request, payload: { directory: root } })).statusCode).toBe(400);
    expect(calls).toBe(before);
  } finally { await app.close(); }
});

test('only one folder dialog can be opened at a time', async () => {
  let release!: (value: null) => void;
  let opened!: () => void;
  const started = new Promise<void>(resolve => { opened = resolve; });
  const { app } = await createApp(config(), undefined, () => new Promise(resolve => { release = resolve; opened(); }));
  try {
    const first = app.inject(request).then(response => response);
    await started;
    expect((await app.inject(request)).statusCode).toBe(409);
    release(null); expect((await first).statusCode).toBe(200);
  } finally { await app.close(); }
});

test('selecting a folder containing internal settings does not write into the library', async () => {
  const { app, index } = await createApp(config(), undefined, async () => root);
  try {
    const response = await app.inject(request);
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('SETTINGS_INSIDE_LIBRARY');
    expect(index.status.directoryConfigured).toBe(false);
    expect(await loadDirectory(config().settingsFile)).toBeUndefined();
  } finally { await app.close(); }
});

test('closing the server aborts an outstanding folder picker', async () => {
  let opened!: () => void;
  const started = new Promise<void>(resolve => { opened = resolve; });
  const { app } = await createApp(config(), undefined, async (_directory, signal) => {
    opened();
    return new Promise((_resolve, reject) => { signal!.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }); });
  });
  const response = app.inject(request).then(response => response);
  await started;
  await app.close();
  expect((await response).statusCode).toBe(503);
});

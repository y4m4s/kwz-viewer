import { test, expect, vi, beforeEach, afterEach } from 'vitest';
const native = vi.hoisted(() => ({ invoke: vi.fn(), convertFileSrc: vi.fn((path: string) => `asset://${path}`), listen: vi.fn(async (_event: string, _handler: () => void) => () => {}) }));
vi.mock('@tauri-apps/api/core', () => ({ ...native, isTauri: () => true }));
vi.mock('@tauri-apps/api/event', () => ({ listen: native.listen }));
const ready = { directoryConfigured: true, directory: 'C:/notes', scanStatus: 'ready', total: 0, indexed: 0, failed: 0, lastScannedAt: null };
beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers(); native.invoke.mockReset(); native.listen.mockClear();
  native.invoke.mockImplementation(async (command: string) => {
    if (command === 'desktop_initialize' || command === 'library_status') return ready;
    if (command === 'library_list') return { items: [{ id: 'a'.repeat(64), thumbnailUrl: 'cache.png' }], total: 1, page: 1, pageSize: 6 };
    if (command === 'library_note') return null;
    if (command === 'library_select') return null;
    throw new Error(`Unexpected native command: ${command}`);
  });
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Desktop must not start HTTP requests'); }));
  vi.stubGlobal('window', new EventTarget());
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

test('desktop lists use native IPC and cache asset URLs instead of HTTP', async () => {
  const { api } = await import('../apps/web/src/lib/api');
  const result = await api<{ items: { thumbnailUrl: string }[] }>('/api/notes?folder=000&page=2&pageSize=6');
  expect(native.invoke).toHaveBeenCalledWith('library_list', { folder: '000', page: 2, pageSize: 6 });
  expect(result.items[0].thumbnailUrl).toBe('asset://cache.png');
  expect(fetch).not.toHaveBeenCalled();
});

test('missing native notes preserve the HTTP-style 404 contract used by the player', async () => {
  const { api, ApiRequestError } = await import('../apps/web/src/lib/api');
  const request = api(`/api/notes/${'a'.repeat(64)}`);
  await expect(request).rejects.toBeInstanceOf(ApiRequestError);
  await expect(request).rejects.toMatchObject({ status: 404 });
});

test('cancelled native folder selection does not report a successful change', async () => {
  const { api } = await import('../apps/web/src/lib/api');
  expect(await api('/api/library/select', { method: 'POST', body: '{}' })).toEqual({ cancelled: true });
});

test('a cancelled player load discards a late binary IPC response', async () => {
  let deliver!: (bytes: ArrayBuffer) => void;
  let started!: () => void;
  const loading = new Promise<void>(resolve => { started = resolve; });
  const base = native.invoke.getMockImplementation()!;
  native.invoke.mockImplementation((command: string, args: unknown) => command === 'library_read' ? new Promise(resolve => { deliver = resolve; started(); }) : base(command, args));
  const { noteBytes } = await import('../apps/web/src/lib/api');
  const controller = new AbortController();
  const request = noteBytes('a'.repeat(64), controller.signal);
  const rejected = expect(request).rejects.toMatchObject({ name: 'AbortError' });
  await loading; controller.abort(); deliver(new Uint8Array([1, 2, 3]).buffer);
  await rejected; expect(fetch).not.toHaveBeenCalled();
});

test('native initialization can recover after a temporary failure', async () => {
  native.invoke.mockRejectedValueOnce(new Error('temporary'));
  const { initializeDesktop } = await import('../apps/web/src/lib/desktop');
  await expect(initializeDesktop()).rejects.toThrow('temporary');
  await expect(initializeDesktop()).resolves.toBeUndefined();
  expect(native.invoke.mock.calls.filter(([command]) => command === 'desktop_initialize')).toHaveLength(2);
});

test('an unavailable worker ends the native loading state instead of leaving it scanning', async () => {
  const base = native.invoke.getMockImplementation()!;
  native.invoke.mockImplementation((command: string, args: unknown) => {
    if (command === 'library_scan') return Promise.resolve({ generation: 7, pending: ['a'.repeat(64)] });
    if (command === 'library_scan_failed') return Promise.resolve();
    return base(command, args);
  });
  vi.stubGlobal('Worker', class { constructor() { throw new Error('Worker unavailable'); } });
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const { initializeDesktop } = await import('../apps/web/src/lib/desktop');
    await initializeDesktop();
    await vi.advanceTimersByTimeAsync(0);
    expect(native.invoke).toHaveBeenCalledWith('library_scan_failed', { generation: 7 });
  } finally { log.mockRestore(); }
});

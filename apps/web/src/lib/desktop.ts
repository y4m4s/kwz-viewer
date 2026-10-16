import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { version } from 'flipnote.js';
import type { KwzNote, LibraryStatus, NoteList } from '../../../../packages/shared/src/types';
import type { InspectionResult } from './inspect.worker';
import { ApiRequestError } from './api';

let initialized: Promise<void> | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let running = false;
let rerun = false;
let epoch = 0;
let cancelWorker: (() => void) | undefined;
let playbackBusy = false;
let resumeScan: (() => void) | undefined;
export function setPlaybackBusy(active: boolean) {
  playbackBusy = active;
  if (!active) { resumeScan?.(); resumeScan = undefined; }
}
async function notifyStatus(revision: number) {
  const status = await invoke<LibraryStatus>('library_status');
  if (revision === epoch) window.dispatchEvent(new CustomEvent('kwz-library-status', { detail: status }));
}

function requestScan(delay = 900) {
  clearTimeout(timer);
  timer = setTimeout(() => { if (running) rerun = true; else void scan(epoch); }, delay);
}
async function scan(revision: number) {
  running = true;
  let worker: Worker | undefined;
  let generation: number | undefined;
  try {
    const plan = await invoke<{ generation: number; pending: string[] }>('library_scan');
    generation = plan.generation;
    await notifyStatus(revision);
    if (revision !== epoch || !plan.pending.length) return;
    worker = new Worker(new URL('./inspect.worker.ts', import.meta.url), { type: 'module' });
    for (const id of plan.pending) {
      while (playbackBusy && revision === epoch) await new Promise<void>(resolve => { resumeScan = resolve; });
      if (revision !== epoch) break;
      let result: InspectionResult;
      try {
        const bytes = await invoke<ArrayBuffer>('library_read', { id, generation: plan.generation });
        if (revision !== epoch) break;
        result = await new Promise<InspectionResult>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('作品の解析がタイムアウトしました。')), 30000);
          const finish = (error?: unknown, value?: InspectionResult) => {
            clearTimeout(timeout); cancelWorker = undefined;
            if (error) reject(error); else resolve(value!);
          };
          cancelWorker = () => finish(new DOMException('Cancelled', 'AbortError'));
          worker!.onmessage = event => finish(undefined, event.data);
          worker!.onerror = event => { event.preventDefault(); finish(new Error(event.message)); };
          worker!.postMessage(bytes, [bytes]);
        });
      } catch (error) {
        if (revision !== epoch) break;
        result = { metadata: null, thumbnail: null, errorCode: 'IO_ERROR' };
        // Restart a failed worker so a broken file cannot stop the remaining library.
        worker.terminate(); worker = new Worker(new URL('./inspect.worker.ts', import.meta.url), { type: 'module' });
      }
      if (revision !== epoch) break;
      if (result.thumbnail) {
        try { await invoke('library_thumbnail', new Uint8Array(result.thumbnail), { headers: { 'x-note-id': id, 'x-library-generation': String(plan.generation) } }); }
        catch { /* A cache failure must not discard valid metadata. */ }
      }
      await invoke('library_complete', { generation: plan.generation, id, metadata: result.metadata, errorCode: result.errorCode ?? null });
    }
  } catch (error) {
    if (revision === epoch) {
      console.error('ライブラリの読み込みに失敗しました。', error);
      if (generation !== undefined) await invoke('library_scan_failed', { generation }).catch(() => {});
    }
  } finally {
    worker?.terminate();
    if (revision === epoch) { running = false; cancelWorker = undefined; await notifyStatus(revision).catch(() => {}); if (rerun) { rerun = false; requestScan(0); } }
  }
}
export function initializeDesktop(): Promise<void> {
  return initialized ??= (async () => {
    const unlistenChange = await listen('library-changed', () => requestScan());
    let unlistenError: (() => void) | undefined;
    try {
      unlistenError = await listen('library-watch-error', () => { void notifyStatus(epoch).catch(() => {}); });
      const status = await invoke<LibraryStatus>('desktop_initialize', { parserVersion: version });
      if (status.directoryConfigured && status.scanStatus !== 'error') requestScan(0);
    } catch (error) {
      unlistenChange(); unlistenError?.(); throw error;
    }
  })().catch(error => {
    initialized = undefined;
    throw error;
  });
}
function imagePaths<T>(value: T): T {
  const convert = (note: KwzNote) => ({ ...note, thumbnailUrl: note.thumbnailUrl ? convertFileSrc(note.thumbnailUrl) : null });
  if (value && typeof value === 'object' && 'items' in value) return { ...value, items: (value as unknown as NoteList).items.map(convert) } as T;
  if (value && typeof value === 'object' && 'thumbnailUrl' in value) return convert(value as unknown as KwzNote) as T;
  return value;
}
export async function desktopApi<T>(url: string, options?: RequestInit): Promise<T> {
  await initializeDesktop();
  const request = new URL(url, 'http://localhost');
  if (options?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  let value: unknown;
  try {
    if (request.pathname === '/api/health') value = await invoke('library_status');
    else if (request.pathname === '/api/folders') value = await invoke('library_folders');
    else if (request.pathname === '/api/notes') value = await invoke('library_list', { folder: request.searchParams.get('folder') || '', page: Number(request.searchParams.get('page') || 1), pageSize: Number(request.searchParams.get('pageSize') || 6) });
    else if (request.pathname === '/api/notes/order') { await invoke('library_move', { command: JSON.parse(String(options?.body || '{}')) }); value = { saved: true }; }
    else if (request.pathname === '/api/library/select') {
      const status = await invoke<LibraryStatus | null>('library_select');
      if (!status) value = { cancelled: true };
      else {
        epoch++; cancelWorker?.(); resumeScan?.(); resumeScan = undefined; cancelWorker = undefined; running = false; rerun = false;
        requestScan(0);
        value = { cancelled: false, status: { ...status, scanStatus: 'scanning', lastScannedAt: null } };
      }
    } else {
      const match = /^\/api\/notes\/([a-f0-9]{64})$/.exec(request.pathname);
      if (!match) throw new ApiRequestError(404, '作品が見つかりません。');
      value = await invoke('library_note', { id: match[1] });
      if (!value) throw new ApiRequestError(404, '作品が見つかりません。');
    }
  } catch (error) { if (error instanceof ApiRequestError) throw error; throw new ApiRequestError(503, typeof error === 'string' ? error : '処理に失敗しました。'); }
  if (options?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  return imagePaths(value) as T;
}
export async function desktopNoteBytes(id: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  await initializeDesktop();
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const bytes = await invoke<ArrayBuffer>('library_read', { id, generation: null });
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  return bytes;
}

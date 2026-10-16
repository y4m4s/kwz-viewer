import type { ApiError } from '../../../../packages/shared/src/types';
import { isTauri } from '@tauri-apps/api/core';
export class ApiRequestError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
export async function api<T>(url: string, options?: RequestInit): Promise<T> {
  if (isTauri()) return (await import('./desktop')).desktopApi<T>(url, options);
  const response = await fetch(url, options);
  if (!response.ok) {
    const body = await response.json().catch(() => null) as ApiError | null;
    throw new ApiRequestError(response.status, body?.error?.message || 'サーバーに接続できません。');
  }
  return response.json() as Promise<T>;
}
export async function noteBytes(id: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  if (isTauri()) return (await import('./desktop')).desktopNoteBytes(id, signal);
  const response = await fetch(`/api/notes/${id}/file`, { signal });
  if (!response.ok) throw new Error('作品を読み取れません。ファイルとコピー完了を確認してください。');
  return response.arrayBuffer();
}
export function playbackPriority(active: boolean) {
  if (isTauri()) void import('./desktop').then(desktop => desktop.setPlaybackBusy(active));
}
export function date(value: string | null): string {
  return value ? new Date(value).toLocaleString('ja-JP') : '不明';
}

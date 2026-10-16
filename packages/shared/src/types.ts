export type KwzNote = {
  id: string; fileName: string; relativePath: string; status: 'ready' | 'error';
  author: string | null; createdAt: string | null; editedAt: string | null;
  fileModifiedAt: string; frameCount: number | null; durationSeconds: number | null;
  loop: boolean | null; byteSize: number; thumbnailUrl: string | null;
  errorCode?: 'INVALID_KWZ' | 'UNSUPPORTED_VARIANT' | 'IO_ERROR';
};
export type LibraryStatus = {
  scanStatus: 'idle' | 'scanning' | 'ready' | 'error'; total: number; indexed: number;
  failed: number; lastScannedAt: string | null; directoryConfigured: boolean; directory?: string; message?: string;
};
export type MoveNote = { folder: string; sourceId: string; targetId: string; placement: 'before' | 'after' };
export type NoteQuery = { page: number; pageSize: number; folder?: string };
export type LibraryFolder = { path: string; count: number };
export type NoteList = { items: KwzNote[]; page: number; pageSize: number; total: number };
export type ApiError = { error: { code: string; message: string } };

import type { Config } from '../config.js';
import type { KwzNote, LibraryStatus, NoteList, NoteQuery, MoveNote } from '../../../../packages/shared/src/types.js';
import { validateRoot, scanFiles, readSafe, type Candidate } from './file-scanner.js';
import { inspectKwz, UnsupportedVariant, type Inspection } from './kwz-service.js';
import { ThumbnailCache } from './thumbnail-cache.js';
import { NoteOrder } from './note-order.js';
export class InvalidMove extends Error {}
export type Entry = { candidate: Candidate; note: KwzNote; thumbnail: Buffer | null };
export class NoteIndex {
  entries = new Map<string, Entry>();
  root: string | null = null;
  status: LibraryStatus;
  private job: Promise<void> | null = null;
  private orderQueue: Promise<unknown> = Promise.resolve();
  private switching = false;
  private orders: NoteOrder;
  constructor(readonly config: Config, private inspect: (bytes: Buffer) => Promise<Inspection> = inspectKwz) {
    this.orders = new NoteOrder(config.orderDirectory ?? '.app-data/orders');
    this.status = { scanStatus: 'idle', total: 0, indexed: 0, failed: 0, lastScannedAt: null, directoryConfigured: !!config.directory };
  }
  rescan(): Promise<void> {
    if (this.job) return this.job;
    this.status = { ...this.status, scanStatus: 'scanning', indexed: 0, failed: 0, message: undefined };
    this.job = this.scan().finally(() => { this.job = null; });
    return this.job;
  }
  async waitForScan(): Promise<void> { await this.job; }
  async waitForIdle(): Promise<void> { await this.orderQueue; await this.waitForScan(); }
  async changeDirectory(directory: string, prepare: () => Promise<void> = async () => {}) {
    if (this.switching) throw new InvalidMove('フォルダの切り替え中です。');
    this.switching = true;
    try {
      // Finish saves against the old library before loading a different order document.
      await this.orderQueue;
      await prepare();
      await this.waitForScan();
      this.config.directory = directory;
      this.entries.clear(); this.root = null;
      this.status = { scanStatus: 'idle', total: 0, indexed: 0, failed: 0, lastScannedAt: null, directoryConfigured: true };
      void this.rescan();
    } finally { this.switching = false; }
  }
  private async scan() {
    try {
      if (!this.config.directory) throw new Error('Not configured');
      const root = await validateRoot(this.config.directory);
      try { await this.orders.load(root); }
      catch { this.status.message = '保存した並び順を読み取れません。自由な並び順は初期順で表示します。'; }
      const candidates = await scanFiles(root, this.config.recursive);
      this.status.total = candidates.length;
      let cache: ThumbnailCache | null = this.config.cacheDirectory ? new ThumbnailCache(this.config.cacheDirectory) : null;
      if (cache) {
        try { await cache.load(root); }
        catch { cache = null; this.status.message = 'キャッシュを利用できないため、原本を変更せずメモリ上で解析しています。'; }
      }
      const next = new Map<string, Entry>();
      // Sequential parsing bounds peak memory; scans never overlap.
      for (const candidate of candidates) {
        const note: KwzNote = { id: candidate.id, fileName: candidate.fileName, relativePath: candidate.relativePath,
          status: 'error', author: null, createdAt: null, editedAt: null, fileModifiedAt: new Date(candidate.mtimeMs).toISOString(),
          frameCount: null, durationSeconds: null, loop: null, byteSize: candidate.byteSize, thumbnailUrl: null };
        let thumbnail: Buffer | null = null;
        try {
          if (candidate.byteSize > this.config.maxBytes) { note.errorCode = 'IO_ERROR'; throw new Error('Too large'); }
          let result = await cache?.get(candidate);
          if (!result) {
            let bytes: Buffer;
            try { bytes = await readSafe(root, candidate, this.config.maxBytes); }
            catch { note.errorCode = 'IO_ERROR'; throw new Error('Read failed'); }
            result = await this.inspect(bytes);
          }
          Object.assign(note, result.metadata, { status: 'ready' });
          thumbnail = result.thumbnail;
          if (thumbnail) note.thumbnailUrl = `/api/notes/${note.id}/thumbnail`;
        } catch (error) {
          note.errorCode ??= error instanceof UnsupportedVariant ? 'UNSUPPORTED_VARIANT' : 'INVALID_KWZ';
          this.status.failed++;
        }
        next.set(note.id, { candidate, note, thumbnail });
        this.status.indexed++;
        // Allow HTTP progress requests between CPU-bound parses.
        await new Promise<void>(resolve => setImmediate(resolve));
      }
      this.entries = next;
      this.root = root;
      if (cache) {
        try { await cache.save(next.values()); }
        catch { this.status.message = 'キャッシュ保存に失敗しました。閲覧は継続できます。'; }
      }
      this.status = { ...this.status, scanStatus: 'ready', lastScannedAt: new Date().toISOString() };
    } catch {
      this.entries.clear(); this.root = null;
      this.status = { ...this.status, scanStatus: 'error', total: 0, indexed: 0, failed: 0,
        message: this.config.directory ? '対象フォルダを読み取れません。フォルダを選び直すか、アクセス権を確認してください。' : 'フォルダを開くボタンから、KWZを保存したフォルダを選択してください。' };
    }
  }
  list(query: NoteQuery): NoteList {
    // Folder names only filter known index entries; they are never OS paths.
    const items = this.orderedIds(query.folder ?? '').map(id => this.entries.get(id)!.note);
    return { items: items.slice((query.page - 1) * query.pageSize, query.page * query.pageSize), page: query.page, pageSize: query.pageSize, total: items.length };
  }
  private orderedIds(folder: string) {
    const notes = [...this.entries.values()].map(e => e.note).filter(n => !folder || n.relativePath.startsWith(`${folder}/`));
    notes.sort((a, b) => b.fileModifiedAt.localeCompare(a.fileModifiedAt) || a.relativePath.localeCompare(b.relativePath));
    return this.orders.arrange(folder, notes.map(n => n.id));
  }
  move(command: MoveNote): Promise<void> {
    if (this.switching) return Promise.reject(new InvalidMove('フォルダの切り替え中です。'));
    const operation = this.orderQueue.then(async () => {
      await this.waitForScan();
      if (!this.root) throw new InvalidMove('ライブラリを読み込んでから並べ替えてください。');
      const ids = this.orderedIds(command.folder);
      if (!ids.includes(command.sourceId) || !ids.includes(command.targetId)) throw new InvalidMove('同じフォルダー内の作品を指定してください。');
      if (command.sourceId === command.targetId) return;
      const next = ids.filter(id => id !== command.sourceId);
      const position = next.indexOf(command.targetId) + (command.placement === 'after' ? 1 : 0);
      next.splice(position, 0, command.sourceId);
      await this.orders.save(this.root, command.folder, next);
    });
    this.orderQueue = operation.catch(() => {});
    return operation;
  }
  folders() {
    const counts = new Map<string, number>();
    for (const { note } of this.entries.values()) {
      const segments = note.relativePath.split('/').slice(0, -1);
      for (let i = 1; i <= segments.length; i++) {
        const folder = segments.slice(0, i).join('/');
        counts.set(folder, (counts.get(folder) ?? 0) + 1);
      }
    }
    return [...counts].sort(([a], [b]) => a.localeCompare(b, 'ja')).map(([path, count]) => ({ path, count }));
  }
}

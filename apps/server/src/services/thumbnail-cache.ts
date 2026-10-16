import { mkdir, readFile, writeFile, rename, lstat, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { version } from 'flipnote.js';
import type { Entry } from './note-index.js';
import type { Candidate } from './file-scanner.js';
import { inside } from './file-scanner.js';
import type { Inspection } from './kwz-service.js';
import { thumbnailMime } from './kwz-service.js';

type Record = { id: string; byteSize: number; mtimeMs: number; metadata: Inspection['metadata']; thumbnailFile: string | null };
export class ThumbnailCache {
  private records = new Map<string, Record>();
  private reused = new Set<string>();
  private folder = '';
  constructor(private base: string) {}
  async load(root: string) {
    this.records.clear();
    this.reused.clear();
    // Resolve the closest existing parent before writing anything; reject links or caches inside originals.
    let ancestor = path.resolve(this.base);
    while (true) {
      try { await lstat(ancestor); break; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      const parent = path.dirname(ancestor); if (parent === ancestor) throw new Error('No parent'); ancestor = parent;
    }
    const physicalBase = path.resolve(await realpath(ancestor), path.relative(ancestor, path.resolve(this.base)));
    if (physicalBase === root || inside(root, physicalBase)) throw new Error('Cache overlaps originals');
    if ((await lstat(ancestor)).isSymbolicLink()) throw new Error('Cache parent is a link');
    this.folder = path.join(physicalBase, createHash('sha256').update(root).digest('hex'));
    await mkdir(this.folder, { recursive: true });
    if ((await lstat(this.folder)).isSymbolicLink() || await realpath(this.folder) !== this.folder) throw new Error('Cache is a link');
    try {
      const doc = JSON.parse(await readFile(path.join(this.folder, 'index.json'), 'utf8'));
      if (doc.version !== 2 || doc.parser !== version || !Array.isArray(doc.records)) return;
      for (const record of doc.records) {
        if (!record || !/^[a-f0-9]{64}$/.test(record.id) || !Number.isSafeInteger(record.byteSize) || !Number.isFinite(record.mtimeMs)) continue;
        const m = record.metadata;
        if (!m || !(m.author === null || typeof m.author === 'string') ||
            ![m.createdAt, m.editedAt].every(v => v === null || typeof v === 'string' && Number.isFinite(Date.parse(v))) ||
            !Number.isSafeInteger(m.frameCount) || m.frameCount < 1 || typeof m.durationSeconds !== 'number' || !Number.isFinite(m.durationSeconds) ||
            typeof m.loop !== 'boolean' || !(record.thumbnailFile === null || /^[a-f0-9]{64}\.[0-9.]+\.(png|jpg)$/.test(record.thumbnailFile))) continue;
        this.records.set(record.id, record);
      }
    } catch { /* Invalid cache is disposable. */ }
  }
  async get(candidate: Candidate): Promise<Inspection | null> {
    const record = this.records.get(candidate.id);
    if (!record || record.byteSize !== candidate.byteSize || record.mtimeMs !== candidate.mtimeMs) return null;
    let thumbnail: Buffer | null = null;
    try {
      if (record.thumbnailFile) {
        const file = path.join(this.folder, record.thumbnailFile);
        const info = await lstat(file);
        if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024) return null;
        thumbnail = await readFile(file);
        if (!thumbnailMime(thumbnail)) return null;
      }
      this.reused.add(candidate.id);
      return { metadata: record.metadata, thumbnail };
    } catch { return null; }
  }
  async save(entries: Iterable<Entry>) {
    if ((await lstat(this.folder)).isSymbolicLink() || await realpath(this.folder) !== this.folder) throw new Error('Cache moved');
    const records: Record[] = [];
    for (const entry of entries) {
      if (entry.note.status !== 'ready') continue; // Retry errors on every scan.
      const { author, createdAt, editedAt, frameCount, durationSeconds, loop } = entry.note;
      const { id, byteSize, mtimeMs } = entry.candidate;
      const extension = entry.thumbnail && thumbnailMime(entry.thumbnail) === 'image/png' ? 'png' : 'jpg';
      const thumbnailFile = entry.thumbnail ? `${id}.${byteSize}.${mtimeMs}.${extension}` : null;
      if (thumbnailFile && !this.reused.has(id)) {
        const target = path.join(this.folder, thumbnailFile);
        const temporary = `${target}.${randomUUID()}.tmp`;
        try {
          await writeFile(temporary, entry.thumbnail!, { flag: 'wx' });
          await rename(temporary, target);
        } finally { await rm(temporary, { force: true }); }
      }
      records.push({ id, byteSize, mtimeMs, metadata: { author, createdAt, editedAt, frameCount, durationSeconds, loop }, thumbnailFile });
    }
    const temporary = path.join(this.folder, `index.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify({ version: 2, parser: version, records }), { flag: 'wx' });
      await rename(temporary, path.join(this.folder, 'index.json'));
    } finally { await rm(temporary, { force: true }); }
  }
}

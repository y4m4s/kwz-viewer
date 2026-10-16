import { lstat, mkdir, readFile, realpath, rename, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { inside } from './file-scanner.js';
class CorruptOrder extends Error {}

// Independent of disposable metadata/thumbnail caches. Folder names are JSON keys, never paths.
export class NoteOrder {
  private orders = new Map<string, string[]>();
  private root: string | null = null;
  constructor(private base: string) {}
  async load(root: string) {
    if (this.root === root) return;
    this.orders.clear(); this.root = null;
    const file = await this.file(root);
    try {
      const info = await lstat(file);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 16 * 1024 * 1024) throw new Error('Invalid order file');
      const doc = JSON.parse(await readFile(file, 'utf8'));
      if (!doc || doc.version !== 1 || !Array.isArray(doc.folders)) throw new CorruptOrder('Invalid order document');
      for (const entry of doc.folders) {
        if (!entry || typeof entry.folder !== 'string' || entry.folder.length > 4096 || !Array.isArray(entry.ids) ||
            !entry.ids.every((id: unknown) => typeof id === 'string' && /^[a-f0-9]{64}$/.test(id)) || new Set(entry.ids).size !== entry.ids.length)
          throw new CorruptOrder('Invalid saved order');
        this.orders.set(entry.folder, entry.ids);
      }
      this.root = root;
    } catch (error) {
      this.orders.clear();
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') { this.root = root; return; }
      if (error instanceof SyntaxError || error instanceof CorruptOrder) this.root = root;
      throw error;
    }
  }
  arrange(folder: string, currentIds: string[]): string[] {
    const known = new Set(currentIds);
    const saved = (this.orders.get(folder) ?? []).filter(id => known.has(id));
    const present = new Set(saved);
    return [...saved, ...currentIds.filter(id => !present.has(id))];
  }
  async save(root: string, folder: string, ids: string[]) {
    if (this.root !== root) await this.load(root);
    const file = await this.file(root);
    const next = new Map(this.orders); next.set(folder, ids);
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify({ version: 1, folders: [...next].map(([folder, ids]) => ({ folder, ids })) }), { flag: 'wx' });
      await rename(temporary, file);
    } finally { await rm(temporary, { force: true }); }
    this.orders = next;
  }
  private async file(root: string) {
    const base = path.resolve(this.base);
    let ancestor = base;
    while (true) {
      try { await lstat(ancestor); break; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      const parent = path.dirname(ancestor); if (parent === ancestor) throw new Error('No parent'); ancestor = parent;
    }
    const physical = path.resolve(await realpath(ancestor), path.relative(ancestor, base));
    if (physical === root || inside(root, physical)) throw new Error('Order directory overlaps originals');
    await mkdir(physical, { recursive: true });
    if ((await lstat(physical)).isSymbolicLink() || await realpath(physical) !== physical) throw new Error('Order directory changed');
    return path.join(physical, `${createHash('sha256').update(root).digest('hex')}.json`);
  }
}

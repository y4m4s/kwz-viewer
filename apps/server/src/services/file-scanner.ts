import { lstat, readdir, realpath, open } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

export type Candidate = { id: string; fileName: string; relativePath: string; byteSize: number; mtimeMs: number };
export function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}
export async function validateRoot(directory: string): Promise<string> {
  const root = path.resolve(directory);
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Invalid root');
  return realpath(root);
}
async function checkedPath(root: string, relativePath: string): Promise<string> {
  const target = path.resolve(root, relativePath);
  if (!inside(root, target)) throw new Error('Outside library');
  let current = root;
  if ((await lstat(root)).isSymbolicLink() || await realpath(root) !== root) throw new Error('Root changed');
  for (const segment of path.relative(root, target).split(path.sep)) {
    current = path.join(current, segment);
    if ((await lstat(current)).isSymbolicLink()) throw new Error('Links are not allowed');
  }
  if (!inside(root, await realpath(target))) throw new Error('Outside library');
  return target;
}
export async function scanFiles(root: string, recursive: boolean): Promise<Candidate[]> {
  const results: Candidate[] = [];
  async function visit(dir: string) {
    if (dir !== root) await checkedPath(root, path.relative(root, dir));
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory() && recursive) await visit(file);
      else if (entry.isFile() && /\.kwz$/i.test(entry.name)) {
        const relativePath = path.relative(root, file).split(path.sep).join('/');
        // Fail the scan if directory enumeration becomes incomplete; don't publish a partial index.
        const info = await lstat(file);
        if (!info.isFile() || info.isSymbolicLink()) continue;
        results.push({ id: createHash('sha256').update(relativePath).digest('hex'),
          fileName: entry.name, relativePath, byteSize: info.size, mtimeMs: info.mtimeMs });
      }
    }
  }
  await visit(root);
  return results;
}
// Open read-only, verify file identity around open, and cap reads even if a file grows.
export async function readSafe(root: string, item: Candidate, maxBytes: number): Promise<Buffer> {
  const target = await checkedPath(root, item.relativePath);
  const before = await lstat(target);
  if (!before.isFile() || before.size > maxBytes) throw new Error('Invalid file or size limit');
  const handle = await open(target, 'r');
  try {
    const opened = await handle.stat();
    await checkedPath(root, item.relativePath);
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size > maxBytes)
      throw new Error('File changed');
    const buffer = Buffer.alloc(opened.size + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    const after = await handle.stat();
    const current = await lstat(target);
    await checkedPath(root, item.relativePath);
    if (offset !== opened.size || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs ||
        current.ino !== opened.ino || current.dev !== opened.dev) throw new Error('File changed during read');
    return buffer.subarray(0, offset);
  } finally { await handle.close(); }
}

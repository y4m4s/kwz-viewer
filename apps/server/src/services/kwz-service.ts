import { parse, FlipnoteFormat, FlipnoteThumbImageFormat, type Flipnote } from 'flipnote.js';
import type { KwzNote } from '../../../../packages/shared/src/types.js';
import { PNG } from 'pngjs';
export type Inspection = { metadata: Pick<KwzNote, 'author' | 'createdAt' | 'editedAt' | 'frameCount' | 'durationSeconds' | 'loop'>; thumbnail: Buffer | null };
export class UnsupportedVariant extends Error {}
export function thumbnailMime(bytes: Buffer): 'image/png' | 'image/jpeg' | null {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  return bytes[0] === 0xff && bytes[1] === 0xd8 ? 'image/jpeg' : null;
}
function frameThumbnail(note: Flipnote): Buffer {
  const pixels = note.getFramePixelsRgba(note.thumbFrameIndex);
  const png = new PNG({ width: note.imageWidth, height: note.imageHeight });
  png.data = Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength);
  return PNG.sync.write(png);
}
export function thumbnailJpeg(note: Flipnote): Buffer | null {
  // flipnote.js 6.3.1 returns bytes.buffer, losing the JPEG view's offset/length.
  // Capture the library's own readBytes view during getThumbnailImage; no KWZ parsing here.
  const read = note.readBytes;
  let view: Uint8Array<ArrayBufferLike> | null = null;
  note.readBytes = function (count) { const bytes = read.call(this, count); view = bytes; return bytes; };
  try {
    const image = note.getThumbnailImage();
    if (image.format !== FlipnoteThumbImageFormat.Jpeg) return null;
    const bytes = view ? Buffer.from(view) : Buffer.from(image.data);
    return bytes[0] === 0xff && bytes[1] === 0xd8 ? bytes : null;
  } finally { note.readBytes = read; }
}
export function isoDate(value: unknown): string | null {
  return value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : null;
}
export async function inspectKwz(bytes: Buffer): Promise<Inspection> {
  const note = await parse(bytes);
  if (note.format !== FlipnoteFormat.KWZ) throw new UnsupportedVariant('Not KWZ');
  if (!note.meta || note.frameCount < 1 || !Number.isFinite(note.duration)) throw new UnsupportedVariant('Missing animation metadata');
  let thumbnail: Buffer | null = null;
  try {
    thumbnail = frameThumbnail(note);
  } catch {
    // A damaged thumbnail frame must not discard otherwise usable metadata.
    try { thumbnail = thumbnailJpeg(note); } catch { /* No thumbnail available. */ }
  }
  return { metadata: {
    author: note.meta.current?.username || null,
    createdAt: 'creationTimestamp' in note.meta ? isoDate(note.meta.creationTimestamp) : null,
    editedAt: isoDate(note.meta.timestamp), frameCount: note.frameCount,
    durationSeconds: note.duration, loop: note.meta.loop ?? null,
  }, thumbnail };
}

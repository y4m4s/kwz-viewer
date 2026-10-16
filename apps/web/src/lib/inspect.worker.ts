import { parse, FlipnoteFormat, FlipnoteThumbImageFormat } from 'flipnote.js';
import type { KwzNote } from '../../../../packages/shared/src/types';

export type NoteMetadata = Pick<KwzNote, 'author' | 'createdAt' | 'editedAt' | 'frameCount' | 'durationSeconds' | 'loop'>;
export type InspectionResult = { metadata: NoteMetadata | null; thumbnail: ArrayBuffer | null; errorCode?: string };
const iso = (value: unknown) => value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : null;

self.onmessage = async (event: MessageEvent<ArrayBuffer>) => {
  let result: InspectionResult;
  try {
    const note = await parse(event.data);
    if (note.format !== FlipnoteFormat.KWZ || !note.meta || note.frameCount < 1 || !Number.isFinite(note.duration)) {
      result = { metadata: null, thumbnail: null, errorCode: 'UNSUPPORTED_VARIANT' };
    } else {
      let thumbnail: ArrayBuffer | null = null;
      try {
        const pixels = note.getFramePixelsRgba(note.thumbFrameIndex);
        const canvas = new OffscreenCanvas(note.imageWidth, note.imageHeight);
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas unavailable');
        context.putImageData(new ImageData(new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.byteLength), note.imageWidth, note.imageHeight), 0, 0);
        thumbnail = await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer();
      } catch {
        // Preserve the JPEG byte range lost by flipnote.js 6.3.1 getThumbnailImage().
        const read = note.readBytes;
        let view: Uint8Array | null = null;
        note.readBytes = function (count) { const bytes = read.call(this, count); view = bytes; return bytes; };
        try {
          const image = note.getThumbnailImage();
          if (image.format === FlipnoteThumbImageFormat.Jpeg) thumbnail = view ? new Uint8Array(view).buffer : image.data;
        } catch { /* Metadata is still useful without a thumbnail. */ }
        finally { note.readBytes = read; }
      }
      result = { metadata: {
        author: note.meta.current?.username || null,
        createdAt: 'creationTimestamp' in note.meta ? iso(note.meta.creationTimestamp) : null,
        editedAt: iso(note.meta.timestamp), frameCount: note.frameCount, durationSeconds: note.duration, loop: note.meta.loop ?? false,
      }, thumbnail };
    }
  } catch { result = { metadata: null, thumbnail: null, errorCode: 'INVALID_KWZ' }; }
  (self as unknown as { postMessage: (message: InspectionResult, transfer: Transferable[]) => void }).postMessage(result, result.thumbnail ? [result.thumbnail] : []);
};

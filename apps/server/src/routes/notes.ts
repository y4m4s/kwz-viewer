import type { FastifyInstance } from 'fastify';
import { InvalidMove, type NoteIndex } from '../services/note-index.js';
import { readSafe } from '../services/file-scanner.js';
import { thumbnailMime } from '../services/kwz-service.js';
import type { NoteQuery, MoveNote } from '../../../../packages/shared/src/types.js';
export function notesRoutes(app: FastifyInstance, index: NoteIndex) {
  app.get('/api/folders', async () => index.folders());
  app.post<{ Body: MoveNote }>('/api/notes/order', {
    schema: { body: { type: 'object', additionalProperties: false, required: ['folder', 'sourceId', 'targetId', 'placement'], properties: {
      folder: { type: 'string', maxLength: 4096 }, sourceId: { type: 'string', pattern: '^[a-f0-9]{64}$' },
      targetId: { type: 'string', pattern: '^[a-f0-9]{64}$' }, placement: { type: 'string', enum: ['before', 'after'] },
    } } },
  }, async (request, reply) => {
    try { await index.move(request.body); return { saved: true }; }
    catch (error) {
      return reply.code(error instanceof InvalidMove ? 400 : 503).send({ error: {
        code: error instanceof InvalidMove ? 'INVALID_MOVE' : 'ORDER_SAVE_FAILED',
        message: error instanceof InvalidMove ? error.message : '並び順を保存できません。保存先のアクセス権を確認してください。',
      } });
    }
  });
  app.get<{ Querystring: NoteQuery }>('/api/notes', {
    schema: { querystring: { type: 'object', additionalProperties: false, properties: {
      folder: { type: 'string', maxLength: 4096 },
      page: { type: 'integer', minimum: 1, maximum: 1000000, default: 1 },
      pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 48 },
    } } },
  }, async request => index.list(request.query));
  for (const suffix of ['', '/thumbnail', '/file']) {
    app.get<{ Params: { id: string } }>(`/api/notes/:id${suffix}`, async (request, reply) => {
      const entry = /^[a-f0-9]{64}$/.test(request.params.id) ? index.entries.get(request.params.id) : undefined;
      if (!entry) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: '作品が見つかりません。' } });
      if (!suffix) return entry.note;
      if (suffix === '/thumbnail') {
        if (!entry.thumbnail) return reply.code(404).send({ error: { code: 'NO_THUMBNAIL', message: 'サムネイルがありません。' } });
        return reply.header('Cache-Control', 'no-cache').type(thumbnailMime(entry.thumbnail) || 'image/jpeg').send(entry.thumbnail);
      }
      try {
        if (!index.root) throw new Error('No root');
        const bytes = await readSafe(index.root, entry.candidate, index.config.maxBytes);
        return reply.header('Cache-Control', 'no-store').type('application/octet-stream').send(bytes);
      } catch {
        return reply.code(409).send({ error: { code: 'FILE_UNAVAILABLE', message: '作品を読み取れません。コピー完了とサイズ上限を確認してください。' } });
      }
    });
  }
}

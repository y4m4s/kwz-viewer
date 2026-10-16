import type { FastifyInstance } from 'fastify';
import type { NoteIndex } from '../services/note-index.js';
export function statusRoutes(app: FastifyInstance, index: NoteIndex) {
  app.get('/api/health', async () => ({ ...index.status, directory: index.config.directory }));
}

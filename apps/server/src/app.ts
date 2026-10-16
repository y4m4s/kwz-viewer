import Fastify from 'fastify';
import staticPlugin from '@fastify/static';
import type { Config } from './config.js';
import { NoteIndex } from './services/note-index.js';
import { notesRoutes } from './routes/notes.js';
import { statusRoutes } from './routes/status.js';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { watchLibrary } from './services/library-watcher.js';
import { loadDirectory, saveDirectory, pickDirectory, checkSettingsLocation, SettingsInsideLibrary } from './services/library-settings.js';
import { validateRoot } from './services/file-scanner.js';

export async function createApp(config: Config, suppliedIndex?: NoteIndex, selectDirectory = pickDirectory) {
  if (config.settingsFile) config.directory = await loadDirectory(config.settingsFile) ?? config.directory;
  const index = suppliedIndex ?? new NoteIndex(config);
  const app = Fastify({ logger: false, ajv: { customOptions: { removeAdditional: false } } });
  const hosts = new Set([`127.0.0.1:${config.port}`, `localhost:${config.port}`]);
  const origins = new Set([...hosts].map(h => `http://${h}`));
  if (config.development) {
    hosts.add('127.0.0.1:5173'); hosts.add('localhost:5173');
    origins.add('http://127.0.0.1:5173'); origins.add('http://localhost:5173');
  }
  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    if (!hosts.has(request.headers.host ?? '') || (origin !== undefined && !origins.has(origin)) ||
        request.headers['sec-fetch-site'] === 'cross-site') {
      return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'ローカルの同一オリジンからアクセスしてください。' } });
    }
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; object-src 'none'");
  });
  app.setErrorHandler((error, _request, reply) => {
    const invalid = typeof error === 'object' && error !== null && 'validation' in error;
    reply.code(invalid ? 400 : 500).send({ error: { code: invalid ? 'INVALID_QUERY' : 'INTERNAL_ERROR',
      message: invalid ? '指定されたパラメータが不正です。' : '処理に失敗しました。' } });
  });
  notesRoutes(app, index); statusRoutes(app, index);
  const webRoot = path.resolve('apps/web/dist');
  if (existsSync(webRoot)) await app.register(staticPlugin, { root: webRoot });
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: { code: 'NOT_FOUND', message: '見つかりません。' } }));
  let watcher = config.watch ? watchLibrary(index) : undefined;
  let choosing = false;
  const pickerAbort = new AbortController();
  app.addHook('preClose', async () => { pickerAbort.abort(); });
  app.post('/api/library/select', {
    schema: { body: { type: 'object', additionalProperties: false, maxProperties: 0 } },
  }, async (request, reply) => {
    if (!request.headers['content-type']?.startsWith('application/json')) return reply.code(415).send({ error: { code: 'JSON_REQUIRED', message: 'JSON形式で送信してください。' } });
    if (choosing) return reply.code(409).send({ error: { code: 'PICKER_BUSY', message: 'フォルダーを選択中です。' } });
    choosing = true;
    try {
      const selected = await selectDirectory(index.config.directory, pickerAbort.signal);
      if (!selected) return { cancelled: true };
      const directory = await validateRoot(selected);
      if (!config.settingsFile) throw new Error('Settings file is not configured');
      await checkSettingsLocation(config.settingsFile, directory);
      await index.changeDirectory(directory, async () => {
        await saveDirectory(config.settingsFile!, directory);
        await watcher?.close();
      });
      config.directory = directory;
      watcher = config.watch ? watchLibrary(index) : undefined;
      return { cancelled: false, status: { ...index.status, directory } };
    } catch (error) {
      if (error instanceof SettingsInsideLibrary) return reply.code(400).send({ error: { code: 'SETTINGS_INSIDE_LIBRARY', message: error.message } });
      return reply.code(503).send({ error: { code: 'DIRECTORY_SELECT_FAILED', message: 'フォルダを選択・保存できませんでした。アクセス権を確認して、もう一度お試しください。' } });
    } finally { choosing = false; }
  });
  app.addHook('onClose', async () => { await watcher?.close(); await index.waitForIdle(); });
  return { app, index };
}

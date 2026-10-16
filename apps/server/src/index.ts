import { createDefaultConfig } from './config.js';
import { createApp } from './app.js';
import { prepareFolderPicker } from './services/library-settings.js';
// Prepare in the background, without delaying the window or showing a dialog.
if (process.platform === 'win32') void prepareFolderPicker().catch(() => {});
const config = { ...createDefaultConfig(), development: process.argv.includes('--dev') };
const { app, index } = await createApp(config);
await app.listen({ host: '127.0.0.1', port: config.port });
void index.rescan();
console.log(`kwz-viewer: http://127.0.0.1:${config.port}`);
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { void app.close().then(() => process.exit(0)); });
}

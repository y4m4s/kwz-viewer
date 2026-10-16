import path from 'node:path';
import { createDefaultConfig } from '../apps/server/src/config';
import { createApp } from '../apps/server/src/app';
import { saveDirectory } from '../apps/server/src/services/library-settings';

// Test fixtures use their own saved settings and never change the user's selection.
const config = { ...createDefaultConfig(), port: 4183, orderDirectory: path.resolve('.app-data/e2e-orders'), settingsFile: path.resolve('.app-data/e2e-settings.json') };
await saveDirectory(config.settingsFile, process.env.KWZ_TEST_DIRECTORY || path.resolve('data'));
const { app, index } = await createApp(config);
await app.listen({ host: '127.0.0.1', port: config.port });
void index.rescan();
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { void app.close().then(() => process.exit(0)); });
}

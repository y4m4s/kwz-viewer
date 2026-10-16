export type Config = { directory?: string; recursive: boolean; port: number; maxBytes: number; cacheDirectory?: string; orderDirectory?: string; settingsFile?: string; watch?: boolean; development?: boolean };
export function createDefaultConfig(): Config {
  return { recursive: true, port: 4173, maxBytes: 32 * 1024 * 1024,
    cacheDirectory: '.app-data/library', orderDirectory: '.app-data/orders', settingsFile: '.app-data/settings.json', watch: true };
}

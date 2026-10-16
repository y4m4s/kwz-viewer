import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: 'tests/e2e', workers: 1, timeout: 45000,
  use: { baseURL: 'http://127.0.0.1:4183', browserName: 'chromium', channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    viewport: { width: 1280, height: 900 }, trace: 'retain-on-failure' },
  webServer: { command: 'npx tsx scripts/e2e-server.ts', url: 'http://127.0.0.1:4183/api/health', reuseExistingServer: false,
  },
});

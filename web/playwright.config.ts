import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  globalSetup: './e2e/global-setup.ts',
  use: { baseURL: 'http://localhost:5174', viewport: { width: 1280, height: 800 } },
  webServer: { command: 'npx vite --port 5174 --strictPort', url: 'http://localhost:5174', reuseExistingServer: !process.env.CI },
});

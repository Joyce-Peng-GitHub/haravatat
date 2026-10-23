import { defineConfig } from '@playwright/test';
const production = process.env.E2E_PRODUCTION === '1';
const apiOrigin = `http://127.0.0.1:${process.env.E2E_API_PORT || '3000'}`;
export default defineConfig({
  testDir: './tests/browser',
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: production ? apiOrigin : 'http://127.0.0.1:5173',
    headless: true,
    viewport: { width: 1440, height: 1050 },
  },
  webServer: production
    ? {
        command: 'node --import tsx tests/e2e-server.ts',
        url: `${apiOrigin}/api/health`,
        timeout: 120_000,
      }
    : [
        {
          command: 'node --import tsx tests/e2e-server.ts',
          url: `${apiOrigin}/api/health`,
          timeout: 120_000,
        },
        {
          command: 'vite --host 127.0.0.1 --port 5173 --strictPort',
          url: 'http://127.0.0.1:5173',
          timeout: 60_000,
        },
      ],
});

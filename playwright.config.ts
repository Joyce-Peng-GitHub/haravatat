import { defineConfig } from '@playwright/test';
const production = process.env.E2E_PRODUCTION === '1';
export default defineConfig({
  testDir: './tests/browser',
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: production ? 'http://127.0.0.1:3000' : 'http://127.0.0.1:5173',
    headless: true,
    viewport: { width: 1440, height: 1050 },
  },
  webServer: production
    ? {
        command: 'node --import tsx tests/e2e-server.ts',
        url: 'http://127.0.0.1:3000/api/health',
        timeout: 120_000,
      }
    : [
        {
          command: 'node --import tsx tests/e2e-server.ts',
          url: 'http://127.0.0.1:3000/api/health',
          timeout: 120_000,
        },
        {
          command: 'vite --host 127.0.0.1 --port 5173 --strictPort',
          url: 'http://127.0.0.1:5173',
          timeout: 60_000,
        },
      ],
});

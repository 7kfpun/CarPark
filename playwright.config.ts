import { defineConfig, devices } from '@playwright/test';

// End-to-end tests run against the production build served by `vite preview`.
// `npm run validate` stays the fast logic suite; this one is separate (npm run test:e2e).
const PORT = 4173;

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  timeout: 180_000,
  fullyParallel: true,
  // Software-rendered WebGL is CPU-bound: on the small CI runner, parallel workers only slow each other down.
  workers: process.env.CI ? 1 : undefined,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  // Small viewport: software-rendered WebGL frames cost far less. The touch tests set their own.
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 320, height: 200 } } }],
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});

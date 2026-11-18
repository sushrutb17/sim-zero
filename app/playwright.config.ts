import { defineConfig } from '@playwright/test';

// Hands-only end-to-end test in the IWER desktop emulator (Task 13). The dev runtime (plain vite + the IWSDK plugin,
// which injects IWER on localhost) is started by Playwright on port 8084 (override with E2E_PORT so parallel sessions
// can each run the suite). It serves HTTPS with a self-signed certificate.
const PORT = Number(process.env.E2E_PORT ?? 8084);
const ORIGIN = `https://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 10 * 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  outputDir: './test-results',
  use: {
    baseURL: ORIGIN,
    // T40: the app opens with the seat 0.10 m back and remembers the user's choice in localStorage. Every hand target in
    // these specs is a world position that equals the emulator's tracking-space position only with no seat offset, so
    // each test starts with the offset stored as 0. e2e/seat.spec.ts moves it with the SEAT buttons.
    storageState: { cookies: [], origins: [{ origin: ORIGIN, localStorage: [{ name: 'trainer.seatOffsetM', value: '0' }] }] },
    ignoreHTTPSErrors: true,
    headless: true,
    viewport: { width: 900, height: 900 },
    launchOptions: { args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] },
    trace: 'off',
  },
  webServer: {
    command: 'npx vite',
    url: `https://localhost:${PORT}/`,
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { IWSDK_DEV_PORT: String(PORT) },
  },
});

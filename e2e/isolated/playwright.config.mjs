import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'operators.spec.mjs',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  forbidOnly: Boolean(process.env.CI),
  // Persist screenshots and sanitized diagnostics, not recorder steps containing
  // the disposable passwords typed into the login form.
  reporter: [['line']],
  outputDir: 'test-results',
  projects: [
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
    // WebKit with a touch viewport is not Safari on a real installed iPhone PWA.
    { name: 'webkit-mobile', use: { ...devices['iPhone 13'] } }
  ]
});

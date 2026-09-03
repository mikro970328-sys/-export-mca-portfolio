const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.cjs',
  // The read-only production journey intentionally covers every certified UX-7
  // workspace on one real iPhone session. BrowserStack device startup and
  // screenshots can legitimately push that journey beyond five minutes.
  timeout: 12 * 60 * 1000,
  expect: { timeout: 30 * 1000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['line']],
  use: {
    baseURL: process.env.ERP_BASE_URL || 'https://admin.exportmca.com',
    actionTimeout: 20 * 1000,
    navigationTimeout: 45 * 1000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  projects: [
    {
      name: 'safari@iPhone 16 Pro:18@browserstack-mobile',
      use: {
        browserName: 'safari',
        channel: 'safari'
      }
    }
  ]
});

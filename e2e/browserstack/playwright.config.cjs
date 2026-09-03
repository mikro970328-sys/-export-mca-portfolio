const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.cjs',
  timeout: 5 * 60 * 1000,
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

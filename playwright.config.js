const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  retries: process.env.CI ? 1 : 0,
  reporter: [['html', { open: 'never' }], ['list']],
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure', video: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: { command: 'node tests/e2e-server.js', port: 4173, reuseExistingServer: !process.env.CI },
});

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3008',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-safari',
      testMatch: /mobile\.spec\.ts/,
      use: { ...devices['iPhone 15'] },
    },
  ],
  webServer: {
    command: 'PORT=3008 npm run dev',
    url: 'http://localhost:3008',
    reuseExistingServer: !process.env.CI,
  },
});

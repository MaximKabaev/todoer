import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch:
    process.env.ROUTING_REAL_API === "1"
      ? ["**/routing.spec.ts", "**/active-project.spec.ts"]
      : "**/*.spec.ts",
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: process.env.WEB_URL || "http://localhost:3000",
    viewport: { width: 1440, height: 900 },
    launchOptions: { args: ["--no-sandbox"] },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});

import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
const output = new URL("../test-results/score-visuals/", import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
try {
  const page = await browser.newPage();
  await page.goto(`${process.env.WEB_URL || "http://localhost:3001"}/login`);
  await page.getByLabel("Username or email", { exact: true }).fill("maxim");
  await page.getByLabel("Password", { exact: true }).fill("todoer");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("heading", { name: "My Tasks", exact: true }).waitFor();
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const colorScheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme });
      for (const path of ["/my", "/people/teammate"]) {
        await page.goto(`${process.env.WEB_URL || "http://localhost:3001"}${path}`);
        await page.getByRole("region", { name: /good boy score/ }).waitFor();
        await page.screenshot({ path: new URL(`${width}-${colorScheme}-${path === "/my" ? "mine" : "teammate"}.png`, output).pathname });
      }
    }
  }
} finally { await browser.close(); }

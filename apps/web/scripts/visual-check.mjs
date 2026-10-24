import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  colorScheme: "light",
  reducedMotion: "reduce",
});
page.on("pageerror", (err) => console.error("BROWSER ERROR:", err.message));
await page.goto("http://localhost:3000");
await page.waitForURL("**/login");
await page.getByLabel("Username", { exact: true }).fill("maxim");
await page.getByLabel("Password", { exact: true }).fill("todoer");
await mkdir(new URL("../docs/screenshots/", import.meta.url), {
  recursive: true,
});
const screenshot = (name) =>
  page.screenshot({
    path: new URL(`../docs/screenshots/${name}.png`, import.meta.url).pathname,
    fullPage: true,
  });
await screenshot("desktop-login-light");
await page.getByRole("button", { name: "Sign in", exact: true }).click();
await page.waitForURL("http://localhost:3000/");
await page
  .getByRole("group", {
    name: "Make a little room for the good stuff",
    exact: true,
  })
  .waitFor();
await screenshot("desktop-light");
await page
  .getByRole("button", {
    name: "Open Make a little room for the good stuff details",
  })
  .click();
await page.getByRole("dialog", { name: "Task details" }).waitFor();
await screenshot("desktop-detail-light");
await page.emulateMedia({ colorScheme: "dark" });
await screenshot("desktop-detail-dark");
await page.getByRole("button", { name: "Close task details" }).click();
await screenshot("desktop-dark");
await page.setViewportSize({ width: 390, height: 844 });
await screenshot("mobile-home-dark");
await page.emulateMedia({ colorScheme: "light" });
await screenshot("mobile-home-light");
await page
  .locator(".mobile-home")
  .getByRole("button", { name: /My Tasks/ })
  .click();
await screenshot("mobile-list-light");
await page.emulateMedia({ colorScheme: "dark" });
await screenshot("mobile-list-dark");
await page.emulateMedia({ colorScheme: "light" });
await page
  .getByRole("button", {
    name: "Open Make a little room for the good stuff details",
  })
  .click();
await screenshot("mobile-detail-light");
await page.emulateMedia({ colorScheme: "dark" });
await screenshot("mobile-detail-dark");
console.log("Saved visual checks to apps/web/docs/screenshots/.");
console.log(
  "Horizontal overflow:",
  await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  ),
);
await browser.close();

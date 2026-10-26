// Renders the home-screen / PWA icons from assets/app-icon.svg (full-bleed square: iOS and
// Android apply their own rounded mask). Run after changing the logo:
//   node scripts/render-icons.mjs   (from apps/web)
import { chromium } from "@playwright/test";
import { readFile } from "node:fs/promises";

const svg = await readFile(new URL("../assets/app-icon.svg", import.meta.url), "utf8");
const targets = [
  ["../app/apple-icon.png", 180],
  ["../public/icons/icon-192.png", 192],
  ["../public/icons/icon-512.png", 512],
];
const browser = await chromium.launch({ args: ["--no-sandbox"] });
for (const [path, size] of targets) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(
    `<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
  );
  await page.screenshot({ path: new URL(path, import.meta.url).pathname, omitBackground: false });
  await page.close();
  console.log(`wrote ${path} (${size}px)`);
}
await browser.close();

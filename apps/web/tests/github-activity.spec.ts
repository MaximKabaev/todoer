import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
const screenshots = "/tmp/claude-1000/-home-mkabaev--t3-projects-todoer/6dc2b483-ef00-4a8f-9192-a13c8608c624/scratchpad/sol-github";

test("GitHub settings save, persist, validate conflicts and clear", async ({ page, playwright }) => {
  await page.request.post("/api/auth/login", { data: { username: "maxim", password: "todoer" } });
  const other = await playwright.request.newContext({ baseURL: process.env.WEB_URL || "http://localhost:3001" });
  await other.post("/api/auth/login", { data: { username: "teammate", password: "todoer" } });
  await other.patch("/api/me", { data: { githubLogin: "qa-other" } });
  try {
    await page.goto("/settings");
    const field = page.getByLabel("GitHub username", { exact: true });
    const save = page.getByRole("button", { name: "Save GitHub", exact: true });
    await field.fill("bad_username"); await save.click();
    await expect(page.locator(".github-section").getByRole("alert")).toHaveText("Enter a valid GitHub username");
    await field.fill("QA-OTHER"); await save.click();
    await expect(page.locator(".github-section").getByRole("alert")).toHaveText("That GitHub username is already linked");
    await field.fill("qa-maxim"); await save.click();
    await expect(page.getByText("Connected as @qa-maxim")).toBeVisible();
    await page.reload(); await expect(field).toHaveValue("qa-maxim");
    await page.getByRole("button", { name: "Clear GitHub", exact: true }).click();
    await expect(field).toHaveValue("");
    await expect.poll(async () => (await (await page.request.get("/api/me")).json()).user.githubLogin).toBeNull();
  } finally {
    await page.request.patch("/api/me", { data: { githubLogin: null } });
    await other.patch("/api/me", { data: { githubLogin: null } });
    await other.dispose();
  }
});

for (const phone of [false, true]) for (const theme of ["light", "dark"] as const) {
  test(`activity states and screenshots ${phone ? "phone" : "desktop"} ${theme}`, async ({ page }) => {
    await mkdir(screenshots, { recursive: true });
    await page.setViewportSize(phone ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await page.request.post("/api/auth/login", { data: { username: "maxim", password: "todoer" } });
    const score = await (await page.request.get("/api/score")).json();
    const base = { day: "2026-11-12", completed: 0, commits: 0, merges: 0, active: false, atRisk: false, githubLinked: false };
    let activity = base;
    await page.route("**/api/score", route => route.fulfill({ json: { ...score, me: { ...score.me, afkPenaltyThisWeek: 10, activity }, teammate: { ...score.teammate, activity } } }));
    const prefix = `${screenshots}/${phone ? "phone" : "desktop"}-${theme}`;
    for (const state of ["active", "risk", "neutral"] as const) {
      activity = { ...base, ...(state === "active" ? { active: true, completed: 2, commits: 5, merges: 1, githubLinked: true } : state === "risk" ? { atRisk: true } : {}) };
      await page.goto("/my");
      const card = page.getByRole("region", { name: "Your good boy score", exact: true });
      await expect(card).toContainText(state === "active" ? "Active today · 2 tasks · 5 commits · 1 merge" : state === "risk" ? "No activity yet today · −5 at midnight" : "No activity yet today · Nothing assigned");
      await expect(card).toContainText("−10 AFK this week");
      await expect(card.getByRole("link", { name: /Connect GitHub/ })).toHaveCount(state === "active" ? 0 : 1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const cardBox = await card.boundingBox();
      const filtersBox = await page.locator(".segmented-control").boundingBox();
      expect(cardBox!.y + cardBox!.height).toBeLessThanOrEqual(filtersBox!.y);
      await card.screenshot({ path: `${prefix}-score-${state}.png` });
    }
    await page.goto("/people/teammate");
    await expect(page.getByRole("region", { name: /good boy score/ }).getByRole("link", { name: /Connect GitHub/ })).toHaveCount(0);
    await page.goto("/settings");
    const section = page.locator(".github-section");
    await expect(section.getByLabel("GitHub username")).toBeVisible();
    await section.scrollIntoViewIfNeeded();
    await section.screenshot({ path: `${prefix}-settings.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

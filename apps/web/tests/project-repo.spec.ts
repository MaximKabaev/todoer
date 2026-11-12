import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
const shots = "/tmp/claude-1000/-home-mkabaev--t3-projects-todoer/6dc2b483-ef00-4a8f-9192-a13c8608c624/scratchpad/sol-project";
mkdirSync(shots, { recursive: true });
for (const mobile of [false, true]) for (const theme of ["light", "dark"] as const) {
  test(`${mobile ? "phone" : "desktop"} ${theme}: project editor and repository`, async ({ page }) => {
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await page.request.post("/api/auth/login", { data: { username: "maxim", password: "todoer" } });
    const response = await page.request.post("/api/projects", { data: { name: `Repo QA ${mobile} ${theme}`, githubRepo: "https://github.com/MaximKabaev/customs-ai.git/" } });
    expect(response.ok()).toBeTruthy();
    const { project } = await response.json();
    expect(project.githubRepo).toBe("MaximKabaev/customs-ai");
    try {
      await page.request.patch("/api/me", { data: { activeProjectId: project.id } });
      await page.goto("/my");
      const link = page.getByRole("link", { name: "MaximKabaev/customs-ai" });
      await expect(link).toHaveAttribute("href", "https://github.com/MaximKabaev/customs-ai");
      await expect(link).toHaveAttribute("target", "_blank");
      await page.screenshot({ path: `${shots}/${mobile ? "phone" : "desktop"}-${theme}-project.png` });
      await page.getByRole("button", { name: /^Active project:/ }).filter({ visible: true }).click();
      await page.getByRole("button", { name: `Edit project ${project.name}`, exact: true }).click();
      const editor = page.getByRole("dialog", { name: "Edit project", exact: true });
      await expect(editor.getByLabel("Project name", { exact: true })).toHaveValue(project.name);
      const bounds = await editor.boundingBox();
      expect(bounds!.width).toBeGreaterThan(320);
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(mobile ? 390 : 1440);
      const swatches = await editor.locator(".color-picker button").evaluateAll(nodes => nodes.map(n => n.getBoundingClientRect().top));
      expect(new Set(swatches).size).toBe(1);
      await page.screenshot({ path: `${shots}/${mobile ? "phone" : "desktop"}-${theme}-editor.png` });
      await editor.getByLabel("GitHub repository").fill("https://example.com/bad/repo");
      await editor.getByRole("button", { name: "Save project", exact: true }).click();
      await expect(editor.getByRole("alert")).toBeVisible();
      await editor.getByLabel("GitHub repository").fill("https://github.com/octocat/Hello-World.git/");
      await editor.getByRole("button", { name: "Save project", exact: true }).click();
      await expect(editor).toHaveCount(0);
      await expect(page.getByRole("link", { name: "octocat/Hello-World" })).toBeVisible();
      await page.reload();
      await expect(page.getByRole("link", { name: "octocat/Hello-World" })).toBeVisible();
      await page.request.patch(`/api/projects/${project.id}`, { data: { githubRepo: "" } });
      await page.reload();
      await expect(page.locator(".project-repo-link")).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    } finally { await page.request.delete(`/api/projects/${project.id}`); }
  });
}
test("new project validates and normalizes a repository", async ({ page }) => {
  await page.request.post("/api/auth/login", { data: { username: "maxim", password: "todoer" } });
  await page.goto("/my");
  await page.getByRole("button", { name: /^Active project:/ }).filter({ visible: true }).click();
  await page.getByRole("button", { name: "New project…", exact: true }).click();
  const form = page.locator(".inline-project-form");
  await form.getByLabel("New project name").fill("Repo creation QA");
  await form.getByLabel("GitHub repository").fill("invalid");
  await form.getByRole("button", { name: "Add project", exact: true }).click();
  await expect(form.getByRole("alert")).toBeVisible();
  await form.getByLabel("GitHub repository").fill("https://github.com/octocat/Hello-World/");
  await form.getByRole("button", { name: "Add project", exact: true }).click();
  await expect(form).toHaveCount(0);
  await expect(page.getByRole("link", { name: "octocat/Hello-World" })).toBeVisible();
  const { projects } = await (await page.request.get("/api/projects")).json();
  const created = projects.find((p: {name: string}) => p.name === "Repo creation QA");
  await page.request.delete(`/api/projects/${created.id}`);
});

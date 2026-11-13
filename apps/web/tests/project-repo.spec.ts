import { test, expect } from "@playwright/test";
for (const mobile of [false, true]) for (const theme of ["light", "dark"] as const) {
  test(`${mobile ? "phone" : "desktop"} ${theme}: project editor and repository`, async ({ page }, testInfo) => {
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await page.request.post("/api/auth/login", { data: { username: "maxim", password: "todoer" } });
    const response = await page.request.post("/api/projects", { data: { name: `Repo QA ${mobile} ${theme}`, githubRepos: ["https://github.com/MaximKabaev/customs-ai.git/", "MaximKabaev/customsai-frontend"] } });
    expect(response.ok()).toBeTruthy();
    const { project } = await response.json();
    expect(project.githubRepos).toEqual(["MaximKabaev/customs-ai", "MaximKabaev/customsai-frontend"]);
    try {
      await page.request.patch("/api/me", { data: { activeProjectId: project.id } });
      await page.goto("/my");
      const link = page.getByRole("link", { name: "MaximKabaev/customs-ai" });
      await expect(link).toHaveAttribute("href", "https://github.com/MaximKabaev/customs-ai");
      await expect(link).toHaveAttribute("target", "_blank");
      await expect(link).toHaveAttribute("rel", "noopener noreferrer");
      const frontend = page.getByRole("link", { name: "MaximKabaev/customsai-frontend", exact: true });
      await expect(frontend).toHaveAttribute("href", "https://github.com/MaximKabaev/customsai-frontend");
      await expect(frontend).toHaveAttribute("target", "_blank");
      await expect(frontend).toHaveAttribute("rel", "noopener noreferrer");
      await expect(frontend).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
      await page.screenshot({ path: testInfo.outputPath("project-two-repos.png") });
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
      await page.screenshot({ path: testInfo.outputPath("dialog-two-repos.png") });
      await expect(editor.getByLabel("GitHub repository 1", { exact: true })).toHaveValue("MaximKabaev/customs-ai");
      await expect(editor.getByLabel("GitHub repository 2", { exact: true })).toHaveValue("MaximKabaev/customsai-frontend");
      await editor.getByRole("button", { name: "Remove repository MaximKabaev/customsai-frontend", exact: true }).click();
      await expect(editor.getByRole("textbox", { name: /^GitHub repository/ })).toHaveCount(1);
      await editor.getByRole("button", { name: "Add repository", exact: true }).click();
      await expect(editor.getByLabel("GitHub repository 2", { exact: true })).toBeFocused();
      await editor.getByLabel("GitHub repository 2", { exact: true }).fill("https://example.com/bad/repo");
      await editor.getByRole("button", { name: "Save project", exact: true }).click();
      await expect(editor.getByRole("alert")).toContainText("Enter each GitHub repo as owner/name");
      await editor.getByLabel("GitHub repository 2", { exact: true }).fill("https://github.com/octocat/Hello-World.git/");
      await editor.getByRole("button", { name: "Save project", exact: true }).click();
      await expect(editor).toHaveCount(0);
      await expect(page.getByRole("link", { name: "octocat/Hello-World" })).toBeVisible();
      await page.reload();
      await expect(page.getByRole("link", { name: "octocat/Hello-World" })).toBeVisible();
      await expect(page.getByRole("link", { name: "MaximKabaev/customs-ai", exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: "MaximKabaev/customsai-frontend", exact: true })).toHaveCount(0);
      await page.getByRole("button", { name: /^Active project:/ }).filter({ visible: true }).click();
      await page.getByRole("button", { name: `Edit project ${project.name}`, exact: true }).click();
      await editor.getByRole("button", { name: "Remove repository MaximKabaev/customs-ai", exact: true }).click();
      await editor.getByRole("button", { name: "Remove repository octocat/Hello-World", exact: true }).click();
      await expect(editor.getByRole("textbox", { name: /^GitHub repository/ })).toHaveCount(1);
      await expect(editor.getByLabel("GitHub repository 1", { exact: true })).toHaveValue("");
      await editor.getByRole("button", { name: "Save project", exact: true }).click();
      await expect(editor).toHaveCount(0);
      await page.reload();
      await expect(page.locator(".project-repo-link")).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    } finally { await page.request.delete(`/api/projects/${project.id}`); }
  });
}
test("inline new project validates and saves two repositories", async ({ page }) => {
  await page.request.post("/api/auth/login", { data: { username: "maxim", password: "todoer" } });
  await page.goto("/my");
  await page.getByRole("button", { name: /^Active project:/ }).filter({ visible: true }).click();
  await page.getByRole("button", { name: "New project…", exact: true }).click();
  const form = page.locator(".inline-project-form");
  await form.getByLabel("New project name").fill("Repo creation QA");
  await form.getByLabel("GitHub repository 1", { exact: true }).fill("invalid");
  await form.getByRole("button", { name: "Add project", exact: true }).click();
  await expect(form.getByRole("alert")).toBeVisible();
  await form.getByLabel("GitHub repository 1", { exact: true }).fill("  https://github.com/octocat/Hello-World/  ");
  await form.getByRole("button", { name: "Add repository", exact: true }).click();
  await expect(form.getByLabel("GitHub repository 2", { exact: true })).toBeFocused();
  await form.getByLabel("GitHub repository 2", { exact: true }).fill("MaximKabaev/customs-ai");
  await form.getByRole("button", { name: "Add repository", exact: true }).click();
  await form.getByRole("button", { name: "Add project", exact: true }).click();
  await expect(form).toHaveCount(0);
  await expect(page.getByRole("link", { name: "octocat/Hello-World" })).toBeVisible();
  const { projects } = await (await page.request.get("/api/projects")).json();
  const created = projects.find((p: {name: string}) => p.name === "Repo creation QA");
  try {
    expect(created.githubRepos).toEqual(["octocat/Hello-World", "MaximKabaev/customs-ai"]);
    await expect(page.getByRole("link", { name: "MaximKabaev/customs-ai", exact: true })).toBeVisible();
  } finally {
    await page.request.delete(`/api/projects/${created.id}`);
  }
});

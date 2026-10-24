import { test, expect } from "@playwright/test";
const taskIds: string[] = [];
const projectIds: string[] = [];
test.beforeEach(async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Username", { exact: true }).fill("maxim");
  await page.getByLabel("Password", { exact: true }).fill("todoer");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "My Tasks", exact: true })).toBeVisible();
  await page.request.patch("/api/me", { data: { lastProjectId: null } });
  await page.reload();
  page.on("response", async (r) => {
    if (r.url().endsWith("/api/tasks") && r.request().method() === "POST" && r.ok()) taskIds.push((await r.json()).task.id);
  });
});
test.afterEach(async ({ page }) => {
  for (const id of taskIds.splice(0)) await page.request.delete(`/api/tasks/${id}`);
  for (const id of projectIds.splice(0)) await page.request.delete(`/api/projects/${id}`);
  await page.request.patch("/api/me", { data: { lastProjectId: null } });
});
test("explicit picker remembers; × skips one capture and Enter retains focus", async ({ page }) => {
  const { project } = await (await page.request.post("/api/projects", { data: { name: "QA composer default", emoji: "🌿", color: "teal" } })).json();
  projectIds.push(project.id);
  await page.reload();
  const picker = page.getByLabel("New task project", { exact: true });
  let records = 0;
  page.on("request", (r) => { if (r.url().endsWith("/api/me") && r.method() === "PATCH") records++; });
  await picker.selectOption(project.id);
  await expect.poll(async () => (await (await page.request.get("/api/me")).json()).user.lastProjectId).toBe(project.id);
  await page.getByRole("button", { name: "Remove project for this task" }).click();
  await expect(picker).toHaveValue("");
  const input = page.getByLabel("New task", { exact: true });
  await input.fill("QA without project once");
  const created = page.waitForResponse((r) => r.url().endsWith("/api/tasks") && r.request().method() === "POST");
  await input.press("Enter");
  expect((await (await created).json()).task.projectId).toBeNull();
  await expect(input).toBeFocused();
  await expect(picker).toHaveValue(project.id);
  expect(records).toBe(1);
  await page.reload();
  await expect(picker).toHaveValue(project.id);
  expect(records).toBe(1);
  const empty = page.waitForResponse((r) => r.url().endsWith("/api/tasks") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Create an empty task and open details" }).click();
  expect((await (await empty).json()).task.projectId).toBe(project.id);
  await page.getByRole("dialog", { name: "Task details" }).getByLabel("Project", { exact: true }).selectOption("");
  await expect.poll(async () => (await (await page.request.get("/api/me")).json()).user.lastProjectId).toBeNull();
  expect(records).toBe(2);
});

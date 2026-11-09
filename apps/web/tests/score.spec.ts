import { test, expect } from "@playwright/test";

test("scores follow the viewed person, refresh after completion, and capture defaults to seven days", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Username or email", { exact: true }).fill("maxim");
  await page.getByLabel("Password", { exact: true }).fill("todoer");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const card = page.getByRole("region", { name: "Your good boy score", exact: true });
  await expect(card).toBeVisible();
  await expect(card).toContainText("All projects");
  const title = `Score capture ${Date.now()}`;
  const created = page.waitForResponse((r) => r.url().endsWith("/api/tasks") && r.request().method() === "POST");
  const input = page.getByRole("textbox", { name: "New task", exact: true });
  await input.fill(`${title} !!!`);
  await input.press("Enter");
  const response = await created;
  expect(response.request().postDataJSON()).not.toHaveProperty("dueDate");
  const { task } = await response.json();
  const expectedDate = await page.evaluate(() => {
    const d = new Date(); d.setDate(d.getDate() + 7);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  });
  expect(task.dueDate).toBe(expectedDate);
  const row = page.getByRole("group", { name: title, exact: true });
  await expect(row.locator(".meta-date")).toHaveCount(0);
  const before = await (await page.request.get("/api/score")).json();
  const refreshed = page.waitForResponse((r) => r.url().endsWith("/api/score") && r.request().method() === "GET");
  await row.getByRole("button", { name: `Complete ${title}`, exact: true }).click();
  const after = await (await refreshed).json();
  expect(after.me.doneThisWeek).toBe(before.me.doneThisWeek + 1);
  expect(after.me.score).toBeGreaterThan(before.me.score);
  await expect(card).toContainText(`${after.me.doneThisWeek} done this week`);
  await page.goto("/people/teammate");
  const other = page.getByRole("region", { name: "Teammate’s good boy score", exact: true });
  await expect(other).toBeVisible();
  await expect(other).toContainText(after.teammate.label);
  await page.request.delete(`/api/tasks/${task.id}`);
});

test("optional score failures and missing teammate do not block capture", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Username or email", { exact: true }).fill("maxim");
  await page.getByLabel("Password", { exact: true }).fill("todoer");
  await page.route("**/api/score", (route) => route.fulfill({ status: 503, json: { error: "Unavailable" } }));
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "New task", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: /good boy score/ })).toHaveCount(0);
  await expect(page.locator(".toast-error")).toHaveCount(0);
  await page.route("**/api/score", (route) => route.fulfill({ json: { teammate: null } }));
  await page.reload();
  await expect(page.getByRole("textbox", { name: "New task", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: /good boy score/ })).toHaveCount(0);
});

test("mock preserves explicit dates and defaults only on Now creation or Later promotion", async ({ request }) => {
  await request.post("/api/auth/login", { data: { username: "maxim", password: "todoer" } });
  const ids: string[] = [];
  const create = async (data: object) => {
    const { task } = await (await request.post("/api/tasks", { data })).json();
    ids.push(task.id); return task;
  };
  try {
    const now = await create({ title: "Default deadline" });
    expect(now.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const cleared = await create({ dueDate: null });
    expect(cleared.dueDate).toBeNull();
    const later = await create({ list: "later" });
    expect(later.dueDate).toBeNull();
    let saved = await (await request.patch(`/api/tasks/${later.id}`, { data: { assignees: ["me"] } })).json();
    expect(saved.task.list).toBe("now");
    expect(saved.task.dueDate).toBe(now.dueDate);
    await request.patch(`/api/tasks/${later.id}`, { data: { list: "later", dueDate: "2000-01-01" } });
    saved = await (await request.post(`/api/tasks/${later.id}/handoff`, { data: { to: "me" } })).json();
    expect(saved.task.dueDate).toBe(now.dueDate);
    await request.patch(`/api/tasks/${later.id}`, { data: { list: "later", dueDate: "2000-01-01" } });
    saved = await (await request.patch(`/api/tasks/${later.id}`, { data: { list: "now", dueDate: null } })).json();
    expect(saved.task.dueDate).toBeNull();
  } finally {
    for (const id of ids) await request.delete(`/api/tasks/${id}`);
  }
});

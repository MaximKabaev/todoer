import { test, expect } from "@playwright/test";

for (const mobile of [false, true]) {
  test(`completion rewards, milestones and Undo (${mobile ? "mobile" : "desktop"})`, async ({ page }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    await page.request.post("/api/auth/login", { data: { username: "maxim", password: "todoer" } });
    const tasks = [];
    for (let i = 0; i < 3; i++) {
      const response = await page.request.post("/api/tasks", { data: { title: `QA victory ${i} ${Date.now()}` } });
      tasks.push((await response.json()).task);
    }
    try {
      await page.goto("/my");
      const progress = page.getByRole("progressbar", { name: "Tasks completed this visit" });
      await expect(progress).toHaveAttribute("value", "0");
      for (let i = 0; i < 2; i++) {
        await page.locator(`[data-task-id="${tasks[i].id}"]`).getByRole("button", { name: `Finish ${tasks[i].title}`, exact: true }).click();
        await expect(progress).toHaveAttribute("value", String(i + 1));
      }
      // The larger completion action in details shares the same rewards and Undo path.
      await page.locator(`[data-task-id="${tasks[2].id}"] .row-open`).click();
      await page.getByRole("button", { name: "Nailed it. Mark as done", exact: true }).click();
      await expect(page.getByRole("status")).toContainText("Hat-trick");
      await expect(progress).toHaveAttribute("value", "3");
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      await expect(progress).toHaveAttribute("value", "2");
      await expect(page.getByRole("button", { name: "Nailed it. Mark as done", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Nailed it. Mark as done", exact: true }).click();
      await expect(progress).toHaveAttribute("value", "3");
      await page.getByRole("button", { name: "Done and dusted · Reopen", exact: true }).click();
      await expect(progress).toHaveAttribute("value", "2");
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      await expect(progress).toHaveAttribute("value", "3");
    } finally {
      for (const task of tasks) await page.request.delete(`/api/tasks/${task.id}`);
    }
  });
}

test("failed completions earn nothing; repeated clicks earn one win; reduced motion suppresses confetti", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.request.post("/api/auth/login", { data: { username: "maxim", password: "todoer" } });
  const { task } = await (await page.request.post("/api/tasks", { data: { title: `QA resilient win ${Date.now()}` } })).json();
  try {
    await page.goto("/my");
    const row = page.locator(`[data-task-id="${task.id}"]`);
    const progress = page.getByRole("progressbar", { name: "Tasks completed this visit" });
    await page.route(`**/api/tasks/${task.id}`, async (route) => {
      if (route.request().method() === "PATCH") await route.fulfill({ status: 500, json: { error: "Try again" } });
      else await route.continue();
    });
    await row.getByRole("button", { name: `Finish ${task.title}`, exact: true }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(progress).toHaveAttribute("value", "0");
    await expect(row.getByRole("button", { name: `Finish ${task.title}`, exact: true })).toBeEnabled();
    await page.unroute(`**/api/tasks/${task.id}`);
    let patches = 0;
    await page.route(`**/api/tasks/${task.id}`, async (route) => {
      if (route.request().method() === "PATCH") {
        patches++;
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      await route.continue();
    });
    // Exercise both visible completion affordances before the save resolves.
    await row.getByRole("button", { name: `Finish ${task.title}`, exact: true }).click();
    await row.locator(".task-check").click();
    await expect(progress).toHaveAttribute("value", "1");
    expect(patches).toBe(1);
    await expect(page.locator(".completion-confetti")).toHaveCSS("display", "none");
  } finally {
    await page.unroute(`**/api/tasks/${task.id}`);
    await page.request.delete(`/api/tasks/${task.id}`);
  }
});

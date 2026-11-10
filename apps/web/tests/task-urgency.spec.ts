import { test, expect } from "@playwright/test";
import type { Task } from "../lib/api";

for (const mobile of [false, true]) {
  test(`priority leads the title and deadline nudges update (${mobile ? "mobile" : "desktop"})`, async ({ page }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    await page.clock.setFixedTime(new Date("2026-11-10T12:00:00Z"));
    await page.request.post("/api/auth/login", { data: { username: "maxim", password: "todoer" } });
    const tasks: Task[] = [];
    for (const input of [
      { title: "QA Urgent deadline", priority: 3, dueDate: "2026-11-10" },
      { title: "QA Bad boy deadline", dueDate: "2026-11-08" },
      { title: "QA Chilling in Later", list: "later", dueDate: "2026-11-08" },
    ]) {
      tasks.push((await (await page.request.post("/api/tasks", { data: input })).json()).task);
    }
    try {
      await page.goto("/my");
      const row = page.locator(`[data-task-id="${tasks[0].id}"]`);
      const priority = row.locator(".priority-heading");
      await expect(priority).toHaveText("High priority");
      await expect(row.locator(".task-meta .priority-heading")).toHaveCount(0);
      const labelBox = (await priority.boundingBox())!;
      const titleBox = (await row.locator(".row-title").boundingBox())!;
      expect(labelBox.y + labelBox.height).toBeLessThanOrEqual(titleBox.y);
      await expect(row.locator(".deadline-nudge")).toContainText("Due today");
      await expect(row.locator(".deadline-nudge")).toContainText("Good boys don’t leave it till tomorrow.");
      const overdue = page.locator(`[data-task-id="${tasks[1].id}"]`);
      await expect(overdue.locator(".deadline-nudge")).toContainText("2 days overdue");
      await expect(overdue.locator(".deadline-nudge")).toContainText("Who’s being a bad boy?");
      await row.locator(".row-open").click();
      const detail = page.getByRole("dialog", { name: "Task details" });
      await expect(detail.locator(".task-urgency")).toContainText("High priority");
      await detail.getByRole("button", { name: "Medium priority", exact: true }).click();
      await expect(detail.locator(".priority-heading")).toHaveText("Medium priority");
      await detail.getByLabel("Due date", { exact: true }).fill("2026-11-11");
      await expect(detail.locator(".deadline-nudge")).toContainText("Due tomorrow");
      await detail.getByLabel("Due date", { exact: true }).fill("2026-11-20");
      await expect(detail.locator(".deadline-nudge")).toHaveCount(0);
      await page.getByRole("button", { name: "Close task details", exact: true }).click();
      await page.goto("/later");
      await expect(page.locator(`[data-task-id="${tasks[2].id}"]`)).toBeVisible();
      await expect(page.locator(`[data-task-id="${tasks[2].id}"] .deadline-nudge`)).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    } finally {
      for (const task of tasks) await page.request.delete(`/api/tasks/${task.id}`);
    }
  });
}

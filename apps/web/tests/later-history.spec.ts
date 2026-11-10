import { test, expect, devices, type Page } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import type { Task, TaskInput } from "../lib/api";

const real = process.env.ROUTING_REAL_API === "1";
const password = (username: string) =>
  real
    ? readFileSync("/tmp/todoer-staging-credentials.txt", "utf8")
        .split(`Username: ${username}\n`)[1]
        .match(/Password: ([^\n]+)/)![1]
    : "todoer";
const shotDir = `/tmp/todoer-later-shots-${process.pid}${real ? "" : "/mock"}`;

async function openTask(page: Page, task: Task, mobile: boolean) {
  const button = page.locator(`[data-task-id="${task.id}"] .row-open`);
  // The mobile scrim covers the list; invoke the same row handler to exercise
  // task switching while the sheet is open, then close it with a real drag.
  if (mobile)
    await button.evaluate((element: HTMLButtonElement) => element.click());
  else await button.click();
  await expect(page).toHaveURL(new RegExp(`/tasks/${task.id}$`));
  await expect(
    page.getByRole("textbox", { name: "Task title", exact: true }),
  ).toHaveValue(task.title);
}

async function sheetClose(page: Page) {
  const handle = page.locator(".sheet-handle");
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 160, {
    steps: 12,
  });
  await page.mouse.up();
}

async function selectMine(page: Page, mobile: boolean) {
  if (mobile && new URL(page.url()).pathname !== "/")
    await page.getByRole("button", { name: "Lists", exact: true }).click();
  await page
    .locator(mobile ? ".mobile-home" : ".sidebar")
    .getByRole("link", { name: /My Tasks/ })
    .click();
  await expect(page).toHaveURL(/\/my$/);
}

for (const mobile of [false, true])
  for (const username of ["maxim", real ? "german" : "teammate"]) {
    test(`${mobile ? "iPhone 13" : "desktop"} ${username}: Later planning and task-switch history`, async ({
      browser,
      baseURL,
    }) => {
      test.setTimeout(120000);
      const context = await browser.newContext({
        baseURL,
        ...(mobile
          ? devices["iPhone 13"]
          : { viewport: { width: 1440, height: 900 } }),
        colorScheme: "light",
        reducedMotion: "reduce",
      });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      const taskIds: string[] = [];
      let projectId: string | undefined;
      let previousProject: string | null | undefined;
      const api = page.request;
      const create = async (input: TaskInput) => {
        const response = await api.post("/api/tasks", {
          data: { projectId, ...input },
        });
        expect(response.ok()).toBeTruthy();
        const { task } = await response.json();
        taskIds.push(task.id);
        return task as Task;
      };
      const get = async (id: string) =>
        (await (await api.get(`/api/tasks/${id}`)).json()).task as Task;
      const patch = async (task: Task, input: TaskInput) => {
        const response = await api.patch(`/api/tasks/${task.id}`, {
          data: input,
        });
        expect(response.ok()).toBeTruthy();
        return (await response.json()).task as Task;
      };
      try {
        expect(
          (
            await api.post("/api/auth/login", {
              data: { username, password: password(username) },
            })
          ).ok(),
        ).toBeTruthy();
        const me = await (await api.get("/api/me")).json();
        previousProject = me.user.activeProjectId;
        projectId = (
          await (
            await api.post("/api/projects", {
              data: { name: `QA Later history ${username} ${Date.now()}` },
            })
          ).json()
        ).project.id;
        expect(
          (
            await api.patch("/api/me", { data: { activeProjectId: projectId } })
          ).ok(),
        ).toBeTruthy();

        // The same contract assertions run against the mock and staging API.
        let later = await create({
          title: "An idea for another day",
          notes: "A shared idea, ready to plan when we are.",
          list: "later",
          assignees: ["me", "teammate"],
        });
        expect(later.assignees).toEqual([]);
        later = await patch(later, { assignees: ["me"] });
        expect(later.list).toBe("now");
        expect(later.assignees.map((u) => u.id)).toEqual([me.user.id]);
        later = await patch(later, {
          list: "later",
          assignees: ["me"],
          addAssignees: ["teammate"],
        });
        expect(later.assignees).toEqual([]);
        later = await patch(later, { addAssignees: ["teammate"] });
        expect(later.list).toBe("now");
        later = await patch(later, { list: "later" });
        const handed = (
          await (
            await api.post(`/api/tasks/${later.id}/handoff`, {
              data: { to: "me" },
            })
          ).json()
        ).task;
        expect(handed.list).toBe("now");
        expect(handed.assignees.map((u: { id: string }) => u.id)).toEqual([
          me.user.id,
        ]);
        later = await patch(later, { list: "later" });

        await page.goto("/later");
        const composer = page.getByRole("textbox", {
          name: "New task",
          exact: true,
        });
        await composer.fill("A future thought @me @both !!");
        await expect(page.locator(".syntax-chips")).not.toContainText(
          me.user.displayName,
        );
        await expect(
          page.getByText("Not assigned on Later", { exact: false }),
        ).toHaveCount(0);
        const captured = page.waitForResponse(
          (r) =>
            r.url().endsWith("/api/tasks") && r.request().method() === "POST",
        );
        await composer.press("Enter");
        const captureResponse = await captured;
        expect(captureResponse.request().postDataJSON()).toMatchObject({
          list: "later",
          assignees: [],
        });
        const capturedTask = (await captureResponse.json()).task as Task;
        taskIds.push(capturedTask.id);
        expect(capturedTask.assignees).toEqual([]);
        expect(capturedTask.title).toBe("A future thought @me @both");
        await expect(
          page.locator(`[data-task-id="${capturedTask.id}"] .assignee-stack`),
        ).toHaveCount(0);
        const row = page.locator(`[data-task-id="${later.id}"]`);
        await expect(
          row.locator("..").locator(".swipe-actions button"),
        ).toHaveCount(1);
        await expect(
          row.locator("..").getByText("Delete", { exact: true }),
        ).toHaveCount(1);
        await expect(
          row.getByRole("button", {
            name: `Complete ${later.title}`,
            exact: true,
          }),
        ).toBeVisible();
        if (mobile) {
          await row.evaluate((element) => {
            element.parentElement!.setPointerCapture = () => {};
            element.parentElement!.hasPointerCapture = () => false;
            for (const [type, x] of [
              ["pointerdown", 200],
              ["pointermove", 90],
              ["pointerup", 90],
            ] as const)
              element.dispatchEvent(
                new PointerEvent(type, {
                  pointerId: 7,
                  pointerType: "touch",
                  clientX: x,
                  clientY: 300,
                  bubbles: true,
                }),
              );
          });
          await expect(row).toHaveAttribute("style", /translateX\(-92px\)/);
          await expect(
            row
              .locator("..")
              .getByRole("button", { name: "Delete", exact: true }),
          ).toBeVisible();
          // Consume the gesture's synthetic click before opening the sheet.
          await row.evaluate((element: HTMLElement) => element.click());
        }

        await openTask(page, later, mobile);
        const detail = page.getByRole("dialog", { name: "Task details" });
        await expect(
          detail.getByText("Later items aren’t assigned yet."),
        ).toBeVisible();
        await expect(
          detail.locator(".assignee-toggles,.handoff-button"),
        ).toHaveCount(0);
        mkdirSync(shotDir, { recursive: true });
        await page.screenshot({
          path: `${shotDir}/${mobile ? "mobile" : "desktop"}-${username}.png`,
        });

        // Hold PATCH responses to distinguish optimistic state from reconciliation.
        await page.route(`**/api/tasks/${later.id}`, async (route) => {
          if (route.request().method() === "PATCH")
            await new Promise((resolve) => setTimeout(resolve, 800));
          await route.continue();
        });
        const planned = page.waitForResponse(
          (r) =>
            r.url().endsWith(`/api/tasks/${later.id}`) &&
            r.request().method() === "PATCH",
        );
        await detail
          .getByRole("button", { name: "Okay, let’s do this", exact: true })
          .click();
        await expect(row).toHaveCount(0, { timeout: 600 });
        await expect(detail.locator(".is-assigned")).toHaveCount(1, {
          timeout: 600,
        });
        expect((await planned).request().postDataJSON()).toEqual({
          list: "now",
          assignees: ["me"],
        });
        expect((await get(later.id)).assignees.map((u) => u.id)).toEqual([
          me.user.id,
        ]);
        await expect(
          page.getByText("Moved to Now", { exact: true }),
        ).toBeVisible();

        const movedLater = page.waitForResponse(
          (r) =>
            r.url().endsWith(`/api/tasks/${later.id}`) &&
            r.request().method() === "PATCH",
        );
        await detail
          .getByRole("button", { name: "Send it back to Later", exact: true })
          .click();
        await expect(detail.locator(".assignee-toggles")).toHaveCount(0, {
          timeout: 600,
        });
        await movedLater;
        expect((await get(later.id)).assignees).toEqual([]);
        await detail.getByRole("button", { name: "Okay, let’s do this", exact: true }).click();
        await expect.poll(async () => (await get(later.id)).list).toBe("now");
        expect((await get(later.id)).assignees.map((u) => u.id)).toEqual([me.user.id]);
        await page
          .getByRole("button", { name: "Close task details", exact: true })
          .click();
        await expect(page).toHaveURL(/\/later$/);
        await page.goto("/my");
        await expect(row).toBeVisible();

        const a = await create({ title: "History task A" });
        const b = await create({ title: "History task B" });
        const c = await create({ title: "History task C" });
        await page.goto("/later");
        await selectMine(page, mobile);
        await openTask(page, a, mobile);
        if (mobile) await openTask(page, b, true);
        else {
          await page.locator(`[data-task-id="${a.id}"]`).focus();
          await page.keyboard.press("ArrowUp");
          await page.keyboard.press("Enter");
          await expect(page).toHaveURL(new RegExp(`/tasks/${b.id}$`));
        }
        await openTask(page, c, mobile);
        // Switching project scope while inspecting must retain the same exit.
        await page
          .getByRole("button", { name: /^Active project:/ })
          .filter({ visible: true })
          .evaluate((element: HTMLButtonElement) => element.click());
        await page
          .locator(".all-projects-option")
          .evaluate((element: HTMLButtonElement) => element.click());
        await detail
          .getByRole("button", { name: "Switch to this project", exact: true })
          .click();
        await expect(detail.locator(".detail-project-context")).toHaveCount(0);
        await expect(page).toHaveURL(new RegExp(`/tasks/${c.id}$`));
        // Settings is a nested history entry and must return to this task.
        const settings = mobile
          ? page.getByRole("button", { name: "Settings", exact: true })
          : page
              .locator(".sidebar")
              .getByRole("link", { name: /Settings & account/ });
        await settings.evaluate((element: HTMLElement) => element.click());
        await expect(page).toHaveURL(/\/settings$/);
        await page.keyboard.press("Escape");
        await expect(page).toHaveURL(new RegExp(`/tasks/${c.id}$`));
        await page
          .getByRole("button", { name: "Close task details", exact: true })
          .click();
        await expect(page).toHaveURL(/\/my$/);
        await expect(detail).toHaveCount(0);
        await page.goBack();
        await expect(page).toHaveURL(mobile ? `${baseURL}/` : /\/later$/);
        await expect(detail).toHaveCount(0);

        // Browser Back from a switched task also returns directly to the list.
        await selectMine(page, mobile);
        await openTask(page, a, mobile);
        await openTask(page, b, mobile);
        await page.goBack();
        await expect(page).toHaveURL(/\/my$/);
        await expect(detail).toHaveCount(0);

        // A fresh deep link keeps back=false across a task switch.
        await page.goto(`/tasks/${a.id}`);
        await expect(detail).toBeVisible();
        await openTask(page, b, mobile);
        await openTask(page, c, mobile);
        await page
          .getByRole("button", { name: "Close task details", exact: true })
          .click();
        await expect(page).toHaveURL(/\/my$/);
        await expect(detail).toHaveCount(0);

        // Auto-opened captures share the existing inspector's history entry.
        await openTask(page, a, mobile);
        const newTask = page.waitForResponse(
          (r) =>
            r.url().endsWith("/api/tasks") && r.request().method() === "POST",
        );
        await page
          .locator(".composer-plus")
          .evaluate((element: HTMLButtonElement) => element.click());
        const auto = (await (await newTask).json()).task;
        taskIds.push(auto.id);
        await expect(page).toHaveURL(new RegExp(`/tasks/${auto.id}$`));
        await page.keyboard.press("Escape");
        await expect(page).toHaveURL(/\/my$/);
        await expect(detail).toHaveCount(0);

        if (mobile) {
          await openTask(page, a, true);
          await openTask(page, b, true);
          await openTask(page, c, true);
          await sheetClose(page);
          await expect(page).toHaveURL(/\/my$/);
          await expect(detail).toHaveCount(0);
          await page.goBack();
          await expect(page).not.toHaveURL(/\/tasks\//);
        }
        expect(errors).toEqual([]);
      } finally {
        for (const id of taskIds) await api.delete(`/api/tasks/${id}`);
        if (previousProject !== undefined)
          await api.patch("/api/me", {
            data: { activeProjectId: previousProject },
          });
        if (projectId) await api.delete(`/api/projects/${projectId}`);
        await api.post("/api/auth/logout");
        await context.close();
      }
    });
  }

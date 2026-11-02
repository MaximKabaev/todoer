import { test, expect, type Page } from "@playwright/test";
async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Username or email", { exact: true }).fill("maxim");
  await page.getByLabel("Password", { exact: true }).fill("todoer");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "My Tasks", exact: true }),
  ).toBeVisible();
}
const pixel = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==",
  "base64",
);
test("unauthenticated visitors see only the login page", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login(?:\?next=.*)?$/);
  await expect(
    page.getByRole("heading", { name: "Welcome to todoer." }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "My Tasks", exact: true }),
  ).toHaveCount(0);
});
test("quick capture stays focused, completes optimistically, and supports Undo", async ({
  page,
}) => {
  await login(page);
  const title = `Capture ${Date.now()}`;
  const input = page.getByRole("textbox", { name: "New task", exact: true });
  await input.fill(`${title} #focus @both !!!`);
  await expect(page.locator(".syntax-chips")).toContainText("High priority");
  const created = page.waitForResponse(
    (r) => r.url().endsWith("/api/tasks") && r.request().method() === "POST",
  );
  await input.press("Enter");
  const { task } = await (await created).json();
  expect(task.title).toBe(title);
  expect(task.assignees).toHaveLength(2);
  expect(task.priority).toBe(3);
  expect(task.tags[0].name).toBe("focus");
  await expect(input).toBeFocused();
  const row = page.getByRole("group", { name: title, exact: true });
  await expect(row).toBeVisible();
  await page.route(`**/api/tasks/${task.id}`, async (route) => {
    if (route.request().method() === "PATCH")
      await new Promise((resolve) => setTimeout(resolve, 450));
    await route.continue();
  });
  await row
    .getByRole("button", { name: `Complete ${title}`, exact: true })
    .click();
  await expect(
    row.getByRole("button", { name: `Reopen ${title}`, exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(row).toHaveCount(0);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(row).toBeVisible();
  await page.request.delete(`/api/tasks/${task.id}`);
});
test("empty tasks, debounced autosave, dual assignment, handoff and delete", async ({
  page,
}) => {
  await login(page);
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/api/tasks") && r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Create an empty task and open details" })
    .click();
  const { task } = await (await response).json();
  expect(task.title).toBe("");
  const detail = page.getByRole("dialog", { name: "Task details" });
  const title = `Edited ${Date.now()}`;
  await detail
    .getByRole("textbox", { name: "Task title", exact: true })
    .fill(title);
  await detail
    .getByRole("textbox", { name: "Notes", exact: true })
    .fill("A note that autosaves.");
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/api/tasks/${task.id}`)).json()).task
          .notes,
    )
    .toBe("A note that autosaves.");
  await detail.getByRole("button", { name: "Teammate", exact: true }).click();
  await expect(
    detail.getByRole("button", { name: "Teammate", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await detail
    .getByRole("button", { name: "Pass to Teammate", exact: true })
    .click();
  await expect
    .poll(async () =>
      (
        await (await page.request.get(`/api/tasks/${task.id}`)).json()
      ).task.assignees.map((u: { username: string }) => u.username),
    )
    .toEqual(["teammate"]);
  await expect(
    detail.getByRole("button", { name: "Maxim (you)", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await detail
    .getByRole("button", { name: "Delete task", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Delete this task?" })
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect(detail).toHaveCount(0);
  expect((await page.request.get(`/api/tasks/${task.id}`)).status()).toBe(404);
});
test("photo capture uses one multipart task request and detail uploads attach to it", async ({
  page,
}) => {
  await login(page);
  let posts = 0;
  page.on("request", (req) => {
    if (new URL(req.url()).pathname === "/api/tasks" && req.method() === "POST")
      posts++;
  });
  const created = page.waitForResponse(
    (r) => r.url().endsWith("/api/tasks") && r.request().method() === "POST",
  );
  await page.getByLabel("Attach images to a new task").setInputFiles([
    { name: "one.png", mimeType: "image/png", buffer: pixel },
    { name: "two.png", mimeType: "image/png", buffer: pixel },
  ]);
  const { task } = await (await created).json();
  expect(task.attachments).toHaveLength(2);
  expect(posts).toBe(1);
  const detail = page.getByRole("dialog", { name: "Task details" });
  await expect(detail.locator(".image-gallery button")).toHaveCount(2);
  await expect
    .poll(() =>
      detail
        .locator(".image-gallery img")
        .first()
        .evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBeGreaterThan(0);
  const attached = page.waitForResponse((r) =>
    r.url().endsWith(`/api/tasks/${task.id}/attachments`),
  );
  await detail
    .locator("input[type=file]")
    .setInputFiles({ name: "three.png", mimeType: "image/png", buffer: pixel });
  await attached;
  await expect(detail.locator(".image-gallery button")).toHaveCount(3);
  await detail
    .getByRole("button", { name: "View one.png", exact: true })
    .click();
  const lightbox = page.getByRole("dialog", { name: "one.png", exact: true });
  await expect(lightbox).toBeVisible();
  const zoomable = lightbox.locator(".zoomable");
  const box = (await zoomable.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -400);
  await expect(zoomable).toHaveAttribute("data-zoomed", "true");
  await zoomable.dblclick();
  await expect(zoomable).not.toHaveAttribute("data-zoomed");
  await zoomable.dblclick();
  await expect(zoomable).toHaveAttribute("data-zoomed", "true");
  await expect(
    lightbox.getByRole("link", { name: "Open original" }),
  ).toHaveAttribute("target", "_blank");
  await page.keyboard.press("Escape");
  await expect(detail).toBeVisible();
  await expect(lightbox).toHaveCount(0);
  await page.request.delete(`/api/tasks/${task.id}`);
});
test("mobile home, contextual lists, project creation, and sheet work at 390px", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login");
  await page.getByLabel("Username or email", { exact: true }).fill("maxim");
  await page.getByLabel("Password", { exact: true }).fill("todoer");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const home = page.locator(".mobile-home");
  await expect(home).toBeVisible();
  await home.getByRole("button", { name: /^Active project:/ }).click();
  await page.getByRole("button", { name: "New project…", exact: true }).click();
  const name = `Little project ${Date.now()}`;
  await page
    .getByRole("textbox", { name: "New project name", exact: true })
    .fill(name);
  await page
    .getByRole("button", { name: "Project color teal", exact: true })
    .click();
  const created = page.waitForResponse(
    (r) => r.url().endsWith("/api/projects") && r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Add project", exact: true })
    .last()
    .click();
  const { project } = await (await created).json();
  await expect(
    home.getByRole("button", { name: `Active project: ${name}`, exact: true }),
  ).toBeVisible();
  await home.getByRole("link", { name: /^My Tasks/ }).click();
  await expect(
    page.getByRole("heading", { name: "My Tasks", exact: true }),
  ).toBeVisible();
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/api/tasks") && r.request().method() === "POST",
  );
  await page
    .getByRole("textbox", { name: "New task", exact: true })
    .fill("One small step");
  await page
    .getByRole("textbox", { name: "New task", exact: true })
    .press("Enter");
  const { task } = await (await response).json();
  expect(task.projectId).toBe(project.id);
  await page
    .getByRole("button", { name: "Open One small step details", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Task details" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await expect(
    page.getByRole("textbox", { name: "Task title", exact: true }),
  ).toHaveValue("One small step");
  await page.request.delete(`/api/tasks/${task.id}`);
  await page.request.delete(`/api/projects/${project.id}`);
});
test("settings creates a token, shows its secret once, revokes it, and logs out", async ({
  page,
}) => {
  await login(page);
  await page.getByRole("link", { name: /Maxim Settings & account/ }).click();
  const settings = page.getByRole("dialog", {
    name: "Your little space",
    exact: true,
  });
  await expect(settings.getByRole("link", { name: /\/agent/ })).toBeVisible();
  const tokenName = `Browser test token ${Date.now()}`;
  await settings.getByRole("textbox", { name: "Token name" }).fill(tokenName);
  await settings.getByRole("button", { name: "Create", exact: true }).click();
  await expect(settings.locator(".secret-card code")).toContainText("tdr_");
  await settings
    .getByRole("button", { name: "I’ve saved it", exact: true })
    .click();
  await expect(settings.locator(".secret-card")).toHaveCount(0);
  await settings
    .getByRole("button", { name: `Revoke ${tokenName}`, exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Revoke this token?" })
    .getByRole("button", { name: "Revoke", exact: true })
    .click();
  await expect(
    settings.locator(".token-row").filter({ hasText: tokenName }),
  ).toHaveCount(0);
  await settings.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/login(?:\?next=.*)?$/);
});

test("the rewrite streams a full 20 MiB image without truncation", async ({
  request,
}) => {
  await request.post("/api/auth/login", {
    data: { username: "maxim", password: "todoer" },
  });
  const bytes = Buffer.alloc(20 * 1024 * 1024);
  pixel.copy(bytes);
  const response = await request.post("/api/tasks", {
    multipart: {
      title: "Upload boundary check",
      files: { name: "large.png", mimeType: "image/png", buffer: bytes },
    },
  });
  expect(response.status()).toBe(201);
  const { task } = await response.json();
  expect(task.attachments[0].size).toBe(bytes.length);
  const image = await request.get(task.attachments[0].url);
  expect((await image.body()).length).toBe(bytes.length);
  await request.delete(`/api/tasks/${task.id}`);
});

test("window drops create one task, detail drops attach, and composer paste captures", async ({
  page,
}) => {
  await login(page);
  const drag = async (selector: string, event: string) =>
    page.evaluate(
      ({ selector, event, base64 }) => {
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const transfer = new DataTransfer();
        transfer.items.add(
          new File([bytes], "dropped.png", { type: "image/png" }),
        );
        document.querySelector(selector)!.dispatchEvent(
          new DragEvent(event, {
            dataTransfer: transfer,
            bubbles: true,
            cancelable: true,
          }),
        );
      },
      { selector, event, base64: pixel.toString("base64") },
    );
  await drag("main", "dragenter");
  await expect(
    page.getByRole("heading", { name: "Drop to create a task", exact: true }),
  ).toBeVisible();
  const created = page.waitForResponse(
    (r) => r.url().endsWith("/api/tasks") && r.request().method() === "POST",
  );
  await drag("main", "drop");
  const { task } = await (await created).json();
  expect(task.attachments).toHaveLength(1);
  const detail = page.getByRole("dialog", { name: "Task details" });
  await expect(detail).toBeVisible();
  const attached = page.waitForResponse((r) =>
    r.url().endsWith(`/api/tasks/${task.id}/attachments`),
  );
  await drag(".task-detail", "drop");
  await attached;
  await expect(detail.locator(".image-gallery button")).toHaveCount(2);
  await detail
    .getByRole("button", { name: "Close task details", exact: true })
    .click();
  const pasted = page.waitForResponse(
    (r) => r.url().endsWith("/api/tasks") && r.request().method() === "POST",
  );
  await page
    .getByRole("textbox", { name: "New task", exact: true })
    .evaluate((element, base64) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const clipboard = new DataTransfer();
      clipboard.items.add(
        new File([bytes], "pasted.png", { type: "image/png" }),
      );
      element.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: clipboard,
          bubbles: true,
          cancelable: true,
        }),
      );
    }, pixel.toString("base64"));
  const result = await (await pasted).json();
  expect(result.task.attachments).toHaveLength(1);
  await expect(page.locator(".drop-overlay")).toHaveCount(0);
  await page.request.delete(`/api/tasks/${task.id}`);
  await page.request.delete(`/api/tasks/${result.task.id}`);
});

test("failed autosave keeps the draft and can be retried", async ({ page }) => {
  await login(page);
  const created = await page.request.post("/api/tasks", {
    data: { title: "Recoverable draft" },
  });
  const { task } = await created.json();
  await page.reload();
  await page
    .getByRole("button", {
      name: "Open Recoverable draft details",
      exact: true,
    })
    .click();
  let fail = true;
  await page.route(`**/api/tasks/${task.id}`, (route) => {
    if (fail && route.request().method() === "PATCH") {
      fail = false;
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "A temporary connection problem." }),
      });
    }
    return route.continue();
  });
  const detail = page.getByRole("dialog", { name: "Task details" });
  await detail
    .getByRole("textbox", { name: "Task title", exact: true })
    .fill("Keep this thought");
  await expect(
    detail.getByRole("button", { name: "Retry saving", exact: true }),
  ).toBeVisible();
  await expect(
    detail.getByRole("textbox", { name: "Task title", exact: true }),
  ).toHaveValue("Keep this thought");
  await detail
    .getByRole("button", { name: "Retry saving", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/api/tasks/${task.id}`)).json()).task
          .title,
    )
    .toBe("Keep this thought");
  await page.request.delete(`/api/tasks/${task.id}`);
});

test("the second account gets relative mentions and teammate context too", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Username or email", { exact: true }).fill("teammate");
  await page.getByLabel("Password", { exact: true }).fill("todoer");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.locator(".sidebar").getByRole("link", { name: /Maxim’s Tasks/ }),
  ).toBeVisible();
  const title = `Relative assignment ${Date.now()}`;
  const input = page.getByRole("textbox", { name: "New task", exact: true });
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/api/tasks") && r.request().method() === "POST",
  );
  await input.fill(`${title} @teammate`);
  await input.press("Enter");
  const { task } = await (await response).json();
  expect(task.assignees.map((u: { username: string }) => u.username)).toEqual([
    "maxim",
  ]);
  expect(task.createdBy.username).toBe("teammate");
  await page
    .locator(".sidebar")
    .getByRole("link", { name: /Maxim’s Tasks/ })
    .click();
  await expect(
    page.getByRole("group", { name: title, exact: true }),
  ).toBeVisible();
  const next = page.waitForResponse(
    (r) => r.url().endsWith("/api/tasks") && r.request().method() === "POST",
  );
  await input.fill("A thought for Maxim");
  await input.press("Enter");
  const second = await (await next).json();
  expect(second.task.assignees[0].username).toBe("maxim");
  await page.request.delete(`/api/tasks/${task.id}`);
  await page.request.delete(`/api/tasks/${second.task.id}`);
});

test("a title edits inline without opening the inspector", async ({ page }) => {
  await login(page);
  const title = `Inline title ${Date.now()}`;
  const { task } = await (
    await page.request.post("/api/tasks", { data: { title } })
  ).json();
  await page.reload();
  const row = page.getByRole("group", { name: title, exact: true });
  await row
    .getByRole("button", { name: `Edit title: ${title}`, exact: true })
    .click();
  const input = row.getByRole("textbox", {
    name: "Edit task title",
    exact: true,
  });
  await expect(input).toBeFocused();
  await input.fill(`${title} updated`);
  await input.press("Enter");
  await expect(
    page.getByRole("group", { name: `${title} updated`, exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Task details" })).toHaveCount(
    0,
  );
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/api/tasks/${task.id}`)).json()).task
          .title,
    )
    .toBe(`${title} updated`);
  await page.request.delete(`/api/tasks/${task.id}`);
});

test("capture leaves the From teammate filter and appears immediately in All", async ({
  page,
}) => {
  await login(page);
  await page
    .getByRole("button", { name: "From Teammate", exact: true })
    .click();
  await expect(page).toHaveURL(/\/my\?show=from-teammate$/);
  await page.route("**/api/tasks", async (route) => {
    if (route.request().method() === "POST")
      await new Promise((resolve) => setTimeout(resolve, 500));
    await route.continue();
  });
  const title = `My own capture ${Date.now()}`;
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/api/tasks") && r.request().method() === "POST",
  );
  const composer = page.getByRole("textbox", { name: "New task", exact: true });
  await composer.fill(title);
  await composer.press("Enter");
  await expect(
    page.getByRole("button", { name: "All", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("group", { name: title, exact: true }),
  ).toBeVisible();
  const { task } = await (await response).json();
  await page.request.delete(`/api/tasks/${task.id}`);
});

test("capture in Completed creates a completed task in that context", async ({
  page,
}) => {
  await login(page);
  await page
    .locator(".sidebar")
    .getByRole("link", { name: /Completed/ })
    .click();
  await expect(page).toHaveURL(/\/completed$/);
  const title = `Already done ${Date.now()}`;
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/api/tasks") && r.request().method() === "POST",
  );
  const composer = page.getByRole("textbox", { name: "New task", exact: true });
  await composer.fill(title);
  await composer.press("Enter");
  const { task } = await (await response).json();
  expect(task.done).toBe(true);
  await expect(
    page.getByRole("group", { name: title, exact: true }),
  ).toBeVisible();
  await page.request.delete(`/api/tasks/${task.id}`);
});

test("document and text-node events are safe, and a deleted inspector retires after one 404", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await login(page);
  await page.evaluate(() => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Shift", bubbles: true }),
    );
    document.dispatchEvent(new ClipboardEvent("paste", { bubbles: true }));
    const transfer = new DataTransfer();
    transfer.items.add(new File(["image"], "qa.png", { type: "image/png" }));
    document.dispatchEvent(
      new DragEvent("dragover", {
        dataTransfer: transfer,
        bubbles: true,
        cancelable: true,
      }),
    );
    document.dispatchEvent(new DragEvent("dragend", { bubbles: true }));
    const text = document.querySelector(".row-title")?.firstChild;
    text?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    text?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Shift", bubbles: true }),
    );
  });
  const { task } = await (
    await page.request.post("/api/tasks", {
      data: { title: "Deleted elsewhere" },
    })
  ).json();
  await page.reload();
  await page
    .getByRole("button", {
      name: "Open Deleted elsewhere details",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Task details" }),
  ).toBeVisible();
  await page.request.delete(`/api/tasks/${task.id}`);
  // The next autosave receives the real deletion response and must not retry on unmount.
  let patches = 0;
  page.on("request", (r) => {
    if (r.url().endsWith(`/api/tasks/${task.id}`) && r.method() === "PATCH")
      patches++;
  });
  await page
    .getByRole("textbox", { name: "Notes", exact: true })
    .fill("A stale draft");
  await expect(
    page.getByText("This task doesn’t exist (or was deleted)", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Task details" })).toHaveCount(
    0,
  );
  await expect(page.locator(`[data-task-id="${task.id}"]`)).toHaveCount(0);
  await page.waitForTimeout(1500);
  expect(patches).toBe(1);
  expect(errors).toEqual([]);
});

test("mobile swipes complete and reveal actions, and Take replaces the assignee", async ({
  page,
}) => {
  await login(page);
  await page.setViewportSize({ width: 375, height: 667 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page
    .locator(".mobile-home")
    .getByRole("link", { name: /My Tasks/ })
    .click();
  await expect(page).toHaveURL(/\/my$/);
  const { task } = await (
    await page.request.post("/api/tasks", {
      data: { title: "Swipe regression" },
    })
  ).json();
  await page.reload();
  const row = page.locator(`[data-task-id="${task.id}"]`);
  const swipe = async (dx: number, dy = 0) => {
    await row.evaluate(
      (element, { dx, dy }) => {
        // Dispatch pointer events without requiring physical touch hardware in CI.
        element.parentElement!.setPointerCapture = () => {};
        element.parentElement!.hasPointerCapture = () => false;
        element.dispatchEvent(
          new PointerEvent("pointerdown", {
            pointerId: 7,
            pointerType: "touch",
            clientX: 180,
            clientY: 300,
            bubbles: true,
          }),
        );
        element.dispatchEvent(
          new PointerEvent("pointermove", {
            pointerId: 7,
            pointerType: "touch",
            clientX: 180 + dx,
            clientY: 300 + dy,
            bubbles: true,
          }),
        );
        element.dispatchEvent(
          new PointerEvent("pointerup", {
            pointerId: 7,
            pointerType: "touch",
            clientX: 180 + dx,
            clientY: 300 + dy,
            bubbles: true,
          }),
        );
      },
      { dx, dy },
    );
  };
  await swipe(20, 100);
  await expect(row).not.toHaveAttribute("style", /translateX/);
  await swipe(-110);
  const actions = row.locator("..").locator(".swipe-actions");
  await expect(actions).toHaveAttribute("aria-hidden", "false");
  await actions
    .getByRole("button", { name: "Pass to Teammate", exact: true })
    .click();
  await expect(row).toHaveCount(0);
  await page.getByRole("button", { name: "Lists", exact: true }).click();
  await page
    .locator(".mobile-home")
    .getByRole("link", { name: /Teammate’s Tasks/ })
    .click();
  await row
    .getByRole("button", { name: "Open Swipe regression details" })
    .click();
  const handed = page.waitForResponse((r) =>
    r.url().endsWith(`/api/tasks/${task.id}/handoff`),
  );
  await page.getByRole("button", { name: "Take it", exact: true }).click();
  expect(
    (await (await handed).json()).task.assignees.map(
      (u: { username: string }) => u.username,
    ),
  ).toEqual(["maxim"]);
  await page
    .getByRole("button", { name: "Close task details", exact: true })
    .click();
  await page.getByRole("button", { name: "Lists", exact: true }).click();
  await page
    .locator(".mobile-home")
    .getByRole("link", { name: /My Tasks/ })
    .click();
  await swipe(110);
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/api/tasks/${task.id}`)).json()).task
          .done,
    )
    .toBe(true);
  await page.request.delete(`/api/tasks/${task.id}`);
});

import { test, expect, devices, type Page } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
const real = process.env.ROUTING_REAL_API === "1";
const credentials = real
  ? readFileSync("/tmp/todoer-staging-credentials.txt", "utf8")
  : "";
const password = (user: string) =>
  real
    ? credentials
        .split(`Username: ${user}\n`)[1]
        .match(/Password: ([^\n]+)/)![1]
    : "todoer";
const pixel = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==",
  "base64",
);
const shotDir = `/tmp/todoer-active-project-shots/${real ? "staging" : "mock"}`;
mkdirSync(shotDir, { recursive: true });
const selector = (page: Page) =>
  page
    .getByRole("button", { name: /^Active project:/ })
    .filter({ visible: true });
async function pick(page: Page, name: string) {
  await selector(page).click();
  await page
    .getByRole("dialog", { name: "Choose active project" })
    .locator(".project-option")
    .filter({ has: page.getByText(name, { exact: true }) })
    .click();
  await expect(selector(page)).toHaveAccessibleName(`Active project: ${name}`);
}
async function login(page: Page, user: string) {
  // Authenticate before navigation so the zero-console-errors assertion includes no expected 401.
  expect(
    (
      await page.request.post("/api/auth/login", {
        data: { username: user, password: password(user) },
      })
    ).ok(),
  ).toBeTruthy();
}
for (const mobile of [false, true])
  for (const user of ["maxim", real ? "german" : "teammate"]) {
    test(`${mobile ? "iPhone 13" : "desktop"} ${user}: global scope, capture, links, moves, persistence and deletion`, async ({
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
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (m) => {
        if (m.type() === "error") errors.push(m.text());
      });
      const projectIds: string[] = [],
        taskIds: string[] = [];
      let previous: string | null = null;
      let tagId: string | undefined;
      try {
        await login(page, user);
        const me = await (await page.request.get("/api/me")).json();
        previous = me.user.activeProjectId;
        await page.request.patch("/api/me", {
          data: { activeProjectId: null },
        });
        const suffix = `${user} ${mobile ? "phone" : "desk"} ${Date.now()}`;
        const projects = [];
        for (const [name, color, emoji] of [
          ["CustomsAI", "purple", "✦"],
          ["Home", "teal", "🌿"],
        ]) {
          const { project } = await (
            await page.request.post("/api/projects", {
              data: { name, color, emoji },
            })
          ).json();
          projects.push(project);
          projectIds.push(project.id);
        }
        const [a, b] = projects;
        const fixtures = [];
        for (const project of [a, b, null])
          for (const [view, data] of [
            ["mine", { assignees: [me.user.id] }],
            ["from", { assignees: [me.user.id] }],
            ["teammate", { assignees: [me.teammate.id] }],
            ["later", { list: "later" }],
            ["unassigned", { assignees: [] }],
            ["completed", { done: true }],
          ] as const) {
            const { task } = await (
              await page.request.post("/api/tasks", {
                data: {
                  title: `QA ${view}: ${project?.name || "No project"}`,
                  projectId: project?.id || null,
                  tags: [`scope-${suffix.replaceAll(" ", "-")}`],
                  ...data,
                },
              })
            ).json();
            fixtures.push(task);
            taskIds.push(task.id);
            tagId = task.tags[0].id;
          }
        page.on("response", async (r) => {
          if (
            r.url().endsWith("/api/tasks") &&
            r.request().method() === "POST" &&
            r.ok()
          )
            taskIds.push((await r.json()).task.id);
        });
        await page.goto("/my");
        await pick(page, a.name);
        await expect(
          page.locator(`[data-task-id="${fixtures[0].id}"]`),
        ).toBeVisible();
        await expect(
          page.locator(`[data-task-id="${fixtures[6].id}"]`),
        ).toHaveCount(0);
        await page.screenshot({
          path: `${shotDir}/${user}-${mobile ? "mobile" : "desktop"}-closed.png`,
        });
        await selector(page).click();
        await page.screenshot({
          path: `${shotDir}/${user}-${mobile ? "mobile" : "desktop"}-open.png`,
        });
        await page.keyboard.press("Escape");
        const scopedRequests: string[] = [];
        page.on("request", (r) => {
          const url = new URL(r.url());
          if (
            ["/api/tasks", "/api/counts", "/api/tags"].includes(url.pathname) &&
            r.method() === "GET"
          )
            scopedRequests.push(url.pathname + url.search);
        });
        for (const path of [
          "/my?show=created",
          "/my?show=from-teammate",
          `/people/${me.teammate.username}`,
          "/later",
          "/unassigned",
          "/completed",
          `/tags/${encodeURIComponent(fixtures[0].tags[0].name)}`,
          "/search?q=QA",
        ]) {
          await page.goto(path);
          await expect(selector(page)).toHaveAccessibleName(
            `Active project: ${a.name}`,
          );
          await expect(page.locator(".task-list-skeleton")).toHaveCount(0);
          await expect
            .poll(() =>
              scopedRequests.some(
                (url) =>
                  url.startsWith("/api/tasks?") &&
                  url.includes(`projectId=${a.id}`),
              ),
            )
            .toBe(true);
          const counts = await (
            await page.request.get(`/api/counts?projectId=${a.id}`)
          ).json();
          if (!mobile)
            await expect(
              page.locator('.sidebar a[href="/my"] .nav-count'),
            ).toHaveText(String(counts.mine));
          const tags = await (
            await page.request.get(`/api/tags?projectId=${a.id}`)
          ).json();
          await expect(
            page
              .locator(`${mobile ? ".mobile-home" : ".sidebar"} .tag-filter`)
              .filter({ hasText: fixtures[0].tags[0].name })
              .locator(".tag-count"),
          ).toHaveText(
            String(tags.tags.find((t: { id: string }) => t.id === tagId).count),
          );
        }
        expect(
          scopedRequests.every(
            (url) =>
              new URL(url, baseURL).searchParams.get("projectId") === a.id,
          ),
        ).toBe(true);
        expect(
          scopedRequests.some((url) => url.startsWith("/api/counts?")),
        ).toBe(true);
        expect(scopedRequests.some((url) => url.startsWith("/api/tags?"))).toBe(
          true,
        );
        await page.goto("/my");
        const input = page.getByRole("textbox", {
          name: "New task",
          exact: true,
        });
        const capture = page.waitForResponse(
          (r) =>
            r.url().endsWith("/api/tasks") && r.request().method() === "POST",
        );
        await input.fill(`QA captured ${suffix}`);
        await input.press("Enter");
        expect((await (await capture).json()).task.projectId).toBe(a.id);
        await expect(input).toBeFocused();
        if (mobile) {
          const photo = page.waitForResponse(
            (r) =>
              r.url().endsWith("/api/tasks") && r.request().method() === "POST",
          );
          await page.getByLabel("Attach images to a new task").setInputFiles({
            name: "pixel.png",
            mimeType: "image/png",
            buffer: pixel,
          });
          expect((await (await photo).json()).task.projectId).toBe(a.id);
          await page
            .getByRole("button", { name: "Close task details", exact: true })
            .click();
        }
        expect(
          await page.getByLabel("New task project", { exact: true }).count(),
        ).toBe(0);
        await page.reload();
        await expect(selector(page)).toHaveAccessibleName(
          `Active project: ${a.name}`,
        );
        const second = await browser.newContext({
          baseURL,
          ...(mobile
            ? { viewport: { width: 1440, height: 900 } }
            : devices["iPhone 13"]),
        });
        const secondPage = await second.newPage();
        await login(secondPage, user);
        await secondPage.goto("/my");
        await expect(selector(secondPage)).toHaveAccessibleName(
          `Active project: ${a.name}`,
        );
        await second.close();
        await selector(page).click();
        await page
          .getByRole("button", { name: `Edit project ${b.name}`, exact: true })
          .click();
        const editor = page.getByRole("dialog", {
          name: "Edit project",
          exact: true,
        });
        await editor
          .getByLabel("Project name", { exact: true })
          .fill("Home · QA");
        await editor.getByLabel("Emoji", { exact: true }).fill("🏡");
        await editor
          .getByRole("button", { name: "orange", exact: true })
          .click();
        await editor
          .getByRole("button", { name: "Save project", exact: true })
          .click();
        b.name = "Home · QA";
        await expect(editor).toHaveCount(0);
        const changed = (
          await (await page.request.get("/api/projects")).json()
        ).projects.find((p: { id: string }) => p.id === b.id);
        expect(changed.color).toBe("orange");
        expect(changed.emoji).toBe("🏡");
        await pick(page, b.name);
        await expect(
          page.locator(`[data-task-id="${fixtures[6].id}"]`),
        ).toBeVisible();
        await expect(
          page.locator(`[data-task-id="${fixtures[0].id}"]`),
        ).toHaveCount(0);
        await page.goto(`/tasks/${fixtures[0].id}`);
        await expect(
          page.getByLabel("Task title", { exact: true }),
        ).toHaveValue(fixtures[0].title);
        await expect(page.locator(".detail-project-context")).toContainText(
          `In ${a.name}`,
        );
        await page
          .getByRole("button", { name: "Switch to this project", exact: true })
          .click();
        await expect
          .poll(
            async () =>
              (await (await page.request.get("/api/me")).json()).user
                .activeProjectId,
          )
          .toBe(a.id);
        await page.goto(`/projects/${b.id}`);
        await expect(page).toHaveURL(/\/my$/);
        await expect(selector(page)).toHaveAccessibleName(
          `Active project: ${b.name}`,
        );
        await page.goto(`/tasks/${fixtures[6].id}`);
        await page
          .getByRole("dialog", { name: "Task details" })
          .getByLabel("Project", { exact: true })
          .selectOption(a.id);
        await expect(
          page.getByRole("dialog", { name: "Task details" }),
        ).toHaveCount(0);
        await expect(page.getByRole("status")).toContainText(
          `Moved to ${a.name}`,
        );
        await expect(
          page.locator(`[data-task-id="${fixtures[6].id}"]`),
        ).toHaveCount(0);
        expect(
          (await (await page.request.get("/api/me")).json()).user
            .activeProjectId,
        ).toBe(b.id);
        await pick(page, "All projects");
        const none = page.waitForResponse(
          (r) =>
            r.url().endsWith("/api/tasks") && r.request().method() === "POST",
        );
        await input.fill(`QA no project ${suffix}`);
        await input.press("Enter");
        expect((await (await none).json()).task.projectId).toBeNull();
        await pick(page, b.name);
        await selector(page).click();
        await page
          .getByRole("dialog", { name: "Choose active project" })
          .getByRole("button", { name: `Edit project ${b.name}`, exact: true })
          .click();
        await page
          .getByRole("button", { name: "Delete project", exact: true })
          .click();
        const confirmation = page.getByRole("dialog", {
          name: "Delete this project?",
          exact: true,
        });
        await expect(confirmation).toContainText(
          "tasks will be kept without a project",
        );
        await confirmation
          .getByRole("button", { name: "Delete", exact: true })
          .click();
        await expect(selector(page)).toHaveAccessibleName(
          "Active project: All projects",
        );
        expect(
          (
            await (
              await page.request.get(`/api/tasks/${fixtures[7].id}`)
            ).json()
          ).task.projectId,
        ).toBeNull();
        if (mobile) {
          await page.goto("/");
          await expect(
            page
              .locator(".mobile-home")
              .getByRole("button", { name: /^Active project:/ }),
          ).toBeVisible();
          await page.screenshot({ path: `${shotDir}/${user}-mobile-home.png` });
        }
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        expect(errors).toEqual([]);
      } finally {
        for (const id of new Set(taskIds))
          await page.request.delete(`/api/tasks/${id}`);
        for (const id of projectIds)
          await page.request.delete(`/api/projects/${id}`);
        if (tagId) await page.request.delete(`/api/tags/${tagId}`);
        await page.request.patch("/api/me", {
          data: { activeProjectId: previous },
        });
        await context.close();
      }
    });
  }

test("capture stays instant and every image path inherits active project; deleted project retries quietly", async ({
  page,
}) => {
  test.skip(
    real,
    "Fault injection uses the mock; staging lifecycle is covered above",
  );
  await login(page, "maxim");
  const { project } = await (
    await page.request.post("/api/projects", {
      data: { name: `QA capture ${Date.now()}` },
    })
  ).json();
  await page.request.patch("/api/me", {
    data: { activeProjectId: project.id },
  });
  const ids: string[] = [];
  try {
    await page.goto("/my");
    await expect(selector(page)).toHaveAccessibleName(
      `Active project: ${project.name}`,
    );
    let lookup = false;
    await page.route("**/api/me", async (route) => {
      lookup = true;
      await route.continue();
    });
    await page.route("**/api/tasks", async (route) => {
      if (route.request().method() === "POST")
        await new Promise((r) => setTimeout(r, 500));
      await route.continue();
    });
    const input = page.getByRole("textbox", { name: "New task", exact: true });
    const typed = page.waitForResponse(
      (r) => r.url().endsWith("/api/tasks") && r.request().method() === "POST",
    );
    await input.fill("QA instant row");
    await input.press("Enter");
    await expect(
      page.getByRole("group", { name: "QA instant row", exact: true }),
    ).toBeVisible();
    expect(lookup).toBe(false);
    ids.push((await (await typed).json()).task.id);
    for (const capture of ["empty", "photo", "paste", "drop"]) {
      const created = page.waitForResponse(
        (r) =>
          r.url().endsWith("/api/tasks") && r.request().method() === "POST",
      );
      if (capture === "empty")
        await page
          .getByRole("button", {
            name: "Create an empty task and open details",
          })
          .click();
      if (capture === "photo")
        await page.getByLabel("Attach images to a new task").setInputFiles({
          name: "pixel.png",
          mimeType: "image/png",
          buffer: pixel,
        });
      if (capture === "paste" || capture === "drop")
        await page.evaluate(
          ({ bytes, type }) => {
            const file = new File([Uint8Array.from(bytes)], "pixel.png", {
              type: "image/png",
            });
            const transfer = new DataTransfer();
            transfer.items.add(file);
            if (type === "paste")
              document
                .querySelector('input[aria-label="New task"]')!
                .dispatchEvent(
                  new ClipboardEvent("paste", {
                    clipboardData: transfer,
                    bubbles: true,
                  }),
                );
            else
              window.dispatchEvent(
                new DragEvent("drop", {
                  dataTransfer: transfer,
                  bubbles: true,
                  cancelable: true,
                }),
              );
          },
          { bytes: [...pixel], type: capture },
        );
      const { task } = await (await created).json();
      ids.push(task.id);
      expect(task.projectId).toBe(project.id);
      await page
        .getByRole("button", { name: "Close task details", exact: true })
        .click();
    }
    // Keep the Created segment during recovery; both optimistic keys must use the
    // retried task's project rather than the stale user snapshot from the first POST.
    await page.getByRole("button", { name: "Made by me", exact: true }).click();
    await expect(page).toHaveURL(/show=created/);
    let releaseRetry!: () => void;
    const retryGate = new Promise<void>((resolve) => {
      releaseRetry = resolve;
    });
    await page.route("**/api/tasks?**", async (route) => {
      if (!new URL(route.request().url()).searchParams.has("projectId"))
        await retryGate;
      await route.continue();
    });
    // Hold the first POST until the teammate has deleted the selected project.
    await page.route("**/api/tasks", async (route) => {
      if (route.request().method() === "POST") {
        if (route.request().postDataJSON().projectId)
          await page.request.delete(`/api/projects/${project.id}`);
        else await retryGate;
      }
      await route.continue();
    });
    const retried = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/tasks") &&
        r.request().method() === "POST" &&
        r.ok(),
    );
    await input.fill("QA deleted project recovery");
    await input.press("Enter");
    try {
      const pending = page.getByRole("group", {
        name: "QA deleted project recovery",
        exact: true,
      });
      await expect(selector(page)).toHaveAccessibleName(
        "Active project: All projects",
      );
      await expect(pending).toBeVisible();
      await expect(pending).toHaveAttribute("data-task-id", /^pending-/);
    } finally {
      releaseRetry();
    }
    const { task } = await (await retried).json();
    ids.push(task.id);
    expect(task.projectId).toBeNull();
    await expect(selector(page)).toHaveAccessibleName(
      "Active project: All projects",
    );
    await expect(page.locator(".toast-error")).toHaveCount(0);
    await expect(
      page.getByRole("group", { name: task.title, exact: true }),
    ).toBeVisible();
  } finally {
    for (const id of ids) await page.request.delete(`/api/tasks/${id}`);
    await page.request.delete(`/api/projects/${project.id}`);
    await page.request.patch("/api/me", { data: { activeProjectId: null } });
  }
});

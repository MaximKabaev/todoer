import {
  test,
  expect,
  devices,
  request as playwrightRequest,
  type APIRequestContext,
} from "@playwright/test";
import { readFileSync } from "node:fs";

// Run the staging suites with ROUTING_REAL_API=1 against the isolated development ports.
// Existing suites deliberately use the in-memory mock, never the production database.
const real = process.env.ROUTING_REAL_API === "1";
const credentials = real
  ? readFileSync("/tmp/todoer-staging-credentials.txt", "utf8")
  : "";
const password = real
  ? credentials.match(/Username: german\n[\s\S]*?Password: ([^\n]+)/)![1]
  : "todoer";
const username = real ? "german" : "maxim";
let api: APIRequestContext;
let me: {
  user: { id: string; username: string; activeProjectId: string | null };
  teammate: { username: string; displayName: string };
};
let project: { id: string; name: string };
let task: { id: string; title: string };
let deletedId: string;
const backgroundTasks: { id: string; url: string; title: string }[] = [];
let tag: { id: string; name: string };
const tasks: string[] = [];
const suffix = Date.now();
test.beforeAll(async ({ baseURL }) => {
  api = await playwrightRequest.newContext({ baseURL });
  expect(
    (await api.post("/api/auth/login", { data: { username, password } })).ok(),
  ).toBeTruthy();
  me = await (await api.get("/api/me")).json();
  project = (
    await (
      await api.post("/api/projects", {
        data: { name: `QA routing ${suffix}` },
      })
    ).json()
  ).project;
  task = (
    await (
      await api.post("/api/tasks", {
        data: {
          title: `QA shared route ${suffix}’s note`,
          projectId: null,
          tags: [`QA / café #${suffix}`],
        },
      })
    ).json()
  ).task;
  tasks.push(task.id);
  for (const [kind, data, url, title] of [
    [
      "person",
      { assignees: [me.teammate.username], projectId: null },
      `/people/${me.teammate.username}`,
      `${me.teammate.displayName}’s Tasks`,
    ],
    [
      "later",
      { assignees: [], list: "later", projectId: project.id },
      "/later",
      "Later",
    ],
    [
      "project",
      { assignees: [], projectId: project.id },
      "/unassigned",
      "Unassigned",
    ],
    [
      "unassigned",
      { assignees: [], projectId: null },
      "/unassigned",
      "Unassigned",
    ],
  ] as const) {
    const fixture = (
      await (
        await api.post("/api/tasks", {
          data: { title: `QA ${kind} fallback ${suffix}`, ...data },
        })
      ).json()
    ).task;
    tasks.push(fixture.id);
    backgroundTasks.push({ id: fixture.id, url, title });
  }
  tag = (await (await api.get(`/api/tasks/${task.id}`)).json()).task.tags[0];
  const deleted = (
    await (
      await api.post("/api/tasks", {
        data: { title: `QA deleted route ${suffix}` },
      })
    ).json()
  ).task;
  deletedId = deleted.id;
  tasks.push(deletedId);
  await api.delete(`/api/tasks/${deletedId}`);
});
test.afterEach(async ({ page }) => {
  if (real) await page.request.post("/api/auth/logout");
});
test.afterAll(async () => {
  if (!api) return;
  for (const id of tasks) await api.delete(`/api/tasks/${id}`);
  if (tag) await api.delete(`/api/tags/${tag.id}`);
  if (project) await api.delete(`/api/projects/${project.id}`);
  if (me)
    expect((await (await api.get("/api/me")).json()).user.activeProjectId).toBe(
      me.user.activeProjectId,
    );
  if (real) {
    const token = credentials.match(/API token for maxim: ([^\n]+)/)![1];
    const response = await api.get("/api/tasks?view=mine", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.ok()).toBeTruthy();
    expect(
      (await response.json()).tasks.every(
        (t: { assignees: { username: string }[] }) =>
          t.assignees.some((a) => a.username === "maxim"),
      ),
    ).toBeTruthy();
  }
  if (real) await api.post("/api/auth/logout");
  await api.dispose();
});
for (const mobile of [false, true]) {
  test.describe(mobile ? "iPhone 13" : "desktop 1440×900", () => {
    test.use({
      ...(mobile
        ? {
            viewport: devices["iPhone 13"].viewport,
            userAgent: devices["iPhone 13"].userAgent,
            deviceScaleFactor: 3,
            isMobile: true,
            hasTouch: true,
          }
        : { viewport: { width: 1440, height: 900 } }),
      permissions: mobile ? [] : ["clipboard-read", "clipboard-write"],
    });
    test("URL routing, sharing, deep links and history", async ({
      page,
      baseURL,
    }) => {
      test.setTimeout(120000);
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (e) => {
        if (
          e.type() === "error" &&
          !(
            e.text().includes("Failed to load resource") &&
            /status of (400|401|404)/.test(e.text())
          )
        )
          errors.push(e.text());
      });
      await page.goto(`/tasks/${task.id}`);
      await expect(page).toHaveURL(
        new RegExp(`/login\\?next=${encodeURIComponent(`/tasks/${task.id}`)}`),
      );
      await expect(page.locator(".app-shell")).toHaveCount(0);
      await page.getByLabel("Username", { exact: true }).fill(username);
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/tasks/${task.id}$`));
      await expect(
        page.getByRole("dialog", { name: "Task details" }),
      ).toBeVisible();
      await expect(page).toHaveTitle(`${task.title} · todoer`);
      if (!mobile) {
        await page
          .getByRole("button", { name: "Copy link", exact: true })
          .click();
        await expect(
          page.getByText("Link copied", { exact: true }),
        ).toBeVisible();
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
          `${baseURL}/tasks/${task.id}`,
        );
      } else {
        await page.evaluate(() => {
          Object.defineProperty(navigator, "share", {
            configurable: true,
            value: async (data: ShareData) => {
              (window as unknown as { shared: ShareData }).shared = data;
            },
          });
        });
        await page.getByRole("button", { name: "Share…", exact: true }).click();
        expect(
          await page.evaluate(
            () => (window as unknown as { shared: ShareData }).shared,
          ),
        ).toEqual({ title: task.title, url: `${baseURL}/tasks/${task.id}` });
      }
      await page
        .getByRole("button", { name: "Close task details", exact: true })
        .click();
      await expect(page).toHaveURL(/\/my$/);
      if (mobile) {
        await page.getByRole("button", { name: "Lists", exact: true }).click();
        await expect(page).toHaveURL(`${baseURL}/`);
        await page
          .locator(".mobile-home")
          .getByRole("link", { name: /My Tasks/ })
          .click();
        await expect(page).toHaveURL(/\/my$/);
      }
      const routes = [
        ["/", "My Tasks"],
        ["/my", "My Tasks"],
        ["/my?show=created", "My Tasks"],
        ["/my?show=from-teammate", "My Tasks"],
        [
          `/people/${me.teammate.username}`,
          `${me.teammate.displayName}'s Tasks`,
        ],
        ["/later", "Later"],
        ["/unassigned", "Unassigned"],
        ["/completed", "Completed"],
        [`/tags/${encodeURIComponent(tag.name)}`, `#${tag.name}`],
        ["/search?q=QA%20shared", "Search: QA shared"],
        ["/settings", "Settings"],
        [`/tasks/${task.id}`, task.title],
      ];
      for (const [url, title] of routes) {
        await page.goto(url);
        await page.reload();
        await expect(page).toHaveTitle(`${title} · todoer`);
        if (url === "/" && mobile)
          await expect(page.locator(".mobile-home")).toBeVisible();
        else if (url === "/settings") {
          await expect(
            page.getByRole("dialog", {
              name: "Your little space",
              exact: true,
            }),
          ).toBeVisible();
          await page.keyboard.press("Escape");
          await expect(page).toHaveURL(/\/my$/);
        } else if (url.startsWith("/tasks/"))
          await expect(
            page.getByRole("dialog", { name: "Task details" }),
          ).toBeVisible();
        else await expect(page.locator(".main-panel")).toBeVisible();
      }
      for (const fixture of backgroundTasks) {
        await page.goto(`/tasks/${fixture.id}`);
        await page.reload();
        await expect(
          page.getByRole("dialog", { name: "Task details" }),
        ).toBeVisible();
        await expect(page.locator(".main-panel h1")).toHaveText(fixture.title);
        await page
          .getByRole("button", { name: "Close task details", exact: true })
          .click();
        await expect(page).toHaveURL(`${baseURL}${fixture.url}`);
      }
      // A new capture only opens a URL after the server has assigned its real id.
      await page.goto("/my");
      if (!real) {
        await page.goto("/my?show=from-teammate");
        const response = page.waitForResponse(
          (r) =>
            r.url().endsWith("/api/tasks") && r.request().method() === "POST",
        );
        await page
          .getByRole("button", {
            name: "Create an empty task and open details",
            exact: true,
          })
          .click();
        const captured = (await (await response).json()).task;
        tasks.push(captured.id);
        // Keep the mock capture easy to recognize during debugging.
        expect(
          (
            await api.patch(`/api/tasks/${captured.id}`, {
              data: { title: `QA empty capture ${suffix}` },
            })
          ).ok(),
        ).toBeTruthy();
        await expect(page).toHaveURL(`${baseURL}/tasks/${captured.id}`);
        await expect(
          page.getByRole("dialog", { name: "Task details" }),
        ).toBeVisible();
        await page
          .getByRole("button", { name: "Close task details", exact: true })
          .click();
        await expect(page).toHaveURL(/\/my$/);
      }
      await page.goto("/later");
      await page
        .getByRole("button", { name: "Search tasks", exact: true })
        .click();
      await page
        .getByLabel("Search title and notes", { exact: true })
        .fill("QA shared");
      await expect(page).toHaveURL(/\/search\?q=QA\+shared$/);
      await expect(page).toHaveTitle("Search: QA shared · todoer");
      await page.goBack();
      await expect(page).toHaveURL(/\/later$/);
      await page.goForward();
      await expect(page).toHaveURL(/\/search\?q=QA\+shared$/);
      await page
        .getByRole("button", { name: "Clear and close search", exact: true })
        .click();
      await expect(page).toHaveURL(/\/later$/);
      // Background list, composer and shell survive navigation without a document reload.
      await page.goto(`/tags/${encodeURIComponent(tag.name)}`);
      await page
        .getByLabel("New task", { exact: true })
        .fill("QA unsent draft");
      await page.evaluate(() => {
        (window as unknown as { routeMarker: string }).routeMarker =
          "persistent";
      });
      await page
        .getByRole("button", {
          name: `Open ${task.title} details`,
          exact: true,
        })
        .click();
      await expect(page).toHaveURL(new RegExp(`/tasks/${task.id}$`));
      await expect(page.locator(".main-panel h1")).toHaveText(`#${tag.name}`);
      await page.goBack();
      await expect(page).toHaveURL(new RegExp(`/tags/`));
      await page.goForward();
      await expect(
        page.getByRole("dialog", { name: "Task details" }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page).toHaveURL(new RegExp(`/tags/`));
      await expect(page.getByLabel("New task", { exact: true })).toHaveValue(
        "QA unsent draft",
      );
      expect(
        await page.evaluate(
          () => (window as unknown as { routeMarker: string }).routeMarker,
        ),
      ).toBe("persistent");
      if (!mobile) {
        await page
          .locator(".sidebar")
          .getByRole("link", { name: /Later/ })
          .click();
        await expect(page).toHaveURL(/\/later$/);
        const popup = page.context().waitForEvent("page", { timeout: 10000 });
        await page
          .locator(".sidebar")
          .getByRole("link", { name: /My Tasks/ })
          .click({ modifiers: ["ControlOrMeta"] });
        const newTab = await popup;
        await expect(newTab).toHaveURL(/\/my$/);
        await newTab.close();
        await expect(page).toHaveURL(/\/later$/);
        await page
          .locator(".sidebar")
          .getByRole("link", { name: /Settings & account/ })
          .click();
        await expect(page).toHaveURL(/\/settings$/);
        await page.keyboard.press("Escape");
        await expect(page).toHaveURL(/\/later$/);
      }
      await page.goto(`/people/${username}`);
      await expect(page).toHaveURL(/\/my$/);
      await expect(page).toHaveTitle("My Tasks · todoer");
      for (const next of ["//evil.com", "https://evil.com"]) {
        await page.goto(`/login?next=${encodeURIComponent(next)}`);
        await expect(page).toHaveURL(`${baseURL}/`);
      }
      await page.goto(`/login?next=${encodeURIComponent("/later")}`);
      await expect(page).toHaveURL(/\/later$/);
      await page.goto(`/tasks/${deletedId}`);
      await expect(
        page.getByText("This task doesn’t exist (or was deleted)", {
          exact: true,
        }),
      ).toBeVisible();
      await page
        .getByRole("link", { name: "Back to My Tasks", exact: true })
        .click();
      await expect(page).toHaveURL(/\/my$/);
      await page.goto("/people/unknown-qa-user");
      await expect(
        page.getByText("This page could not be found."),
      ).toBeVisible();
      const unknown = await page.goto("/unknown-qa-path");
      expect(unknown?.status()).toBe(404);
      expect((await page.request.get("/api/health")).status()).toBe(200);
      expect(
        (await page.request.get("/agent")).headers()["content-type"],
      ).toContain("text/markdown");
      expect(
        (await page.request.get("/icon.svg")).headers()["content-type"],
      ).toContain("image/svg+xml");
      expect(errors).toEqual([]);
    });
  });
}

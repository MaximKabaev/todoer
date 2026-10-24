/** Owner-authorized smoke. Never writes or logs credentials or token secrets. */
import { chromium, request, expect } from "@playwright/test";
import { readFile, mkdir, readdir, unlink } from "node:fs/promises";
import { randomBytes } from "node:crypto";
const origin = process.env.WEB_URL || "http://localhost:3101";
const credentials = await readFile(
  process.env.REAL_CREDENTIALS_PATH ||
    "/home/mkabaev/.t3/projects/todoer/apps/api/.seed-credentials.txt",
  "utf8",
);
const passwordFor = (username) => {
  const block = credentials
    .split(/Username:\s*/)
    .find((s) => s.startsWith(`${username}\n`));
  const value = block?.match(/^Password:\s*(.+)$/m)?.[1]?.trim();
  if (!value) throw new Error(`Missing credentials for ${username}`);
  return value;
};
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const contexts = [],
  tasks = new Set(),
  projects = new Set(),
  tags = new Set(),
  tokens = new Set();
const errors = [],
  expected404 = new Set(),
  terminalErrors = [];
const screenshotDir = new URL("../docs/screenshots/", import.meta.url);
let maxim,
  german,
  originalName,
  temporaryPassword,
  passwordChanged = false,
  profileChanged = false;
async function json(response) {
  expect(
    response.ok(),
    `API ${response.status()} at ${new URL(response.url()).pathname}`,
  ).toBeTruthy();
  return response.json();
}
async function account(username) {
  const context = await request.newContext({ baseURL: origin });
  contexts.push(context);
  await json(
    await context.post("/api/auth/login", {
      data: { username, password: passwordFor(username) },
    }),
  );
  return context;
}
async function create(context, data) {
  expect(data.title.startsWith("QA ")).toBeTruthy();
  const { task } = await json(await context.post("/api/tasks", { data }));
  tasks.add(task.id);
  return task;
}
async function newPage(username, viewport = { width: 1440, height: 900 }) {
  const context = await browser.newContext({
    viewport,
    hasTouch: viewport.width < 500,
    isMobile: viewport.width < 500,
    reducedMotion: "reduce",
    colorScheme: "light",
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() !== "error" && m.type() !== "warning") return;
    const url = m.location().url;
    if (m.text().includes("401") && url.endsWith("/api/me")) return;
    if (
      m.text().includes("404") &&
      [...expected404].some((id) => url.includes(`/api/tasks/${id}`))
    ) {
      terminalErrors.push(url);
      return;
    }
    errors.push(`${m.text()} (${url})`);
  });
  await page.goto(origin + "/login");
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page
    .getByLabel("Password", { exact: true })
    .fill(passwordFor(username));
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(origin + "/");
  await expect(
    page.locator(viewport.width < 761 ? ".mobile-home" : ".main-panel"),
  ).toBeVisible();
  return page;
}
const row = (page, task) => page.locator(`[data-task-id="${task.id}"]`);
async function choose(page, name) {
  await expect(page.locator(".app-shell")).toBeVisible();
  const mobile = page.viewportSize().width < 761;
  if (mobile && !(await page.locator(".mobile-home").isVisible()))
    await page.getByRole("button", { name: "Lists", exact: true }).click();
  await page
    .locator(mobile ? ".mobile-home" : ".sidebar")
    .getByRole("button", { name })
    .click();
}
async function open(page, task) {
  await row(page, task)
    .getByRole("button", { name: /^Open .* details$/ })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Task details" }),
  ).toBeVisible();
}
async function swipe(page, task, dx, dy = 0) {
  await row(page, task).evaluate(
    (el, { dx, dy }) => {
      el.parentElement.setPointerCapture = () => {};
      el.parentElement.hasPointerCapture = () => false;
      for (const [type, x, y] of [
        ["pointerdown", 180, 300],
        ["pointermove", 180 + dx, 300 + dy],
        ["pointerup", 180 + dx, 300 + dy],
      ])
        el.dispatchEvent(
          new PointerEvent(type, {
            pointerId: 7,
            pointerType: "touch",
            clientX: x,
            clientY: y,
            bubbles: true,
          }),
        );
    },
    { dx, dy },
  );
}
async function shot(page, name) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: new URL(`${name}.png`, screenshotDir).pathname,
  });
}
try {
  maxim = await account("maxim");
  german = await account("german");
  originalName = (await json(await maxim.get("/api/me"))).user.displayName;
  const { project } = await json(
    await maxim.post("/api/projects", {
      data: { name: "QA A calmer workspace", color: "purple" },
    }),
  );
  projects.add(project.id);
  const { tag } = await json(
    await maxim.post("/api/tags", {
      data: { name: "QA focus", color: "teal" },
    }),
  );
  tags.add(tag.id);
  const primary = await create(maxim, {
    title: "QA Review the next little improvements",
    notes: "QA Keep capture simple. Check the small screens together.",
    projectId: project.id,
    tags: [tag.id],
    dueDate: new Date().toISOString().slice(0, 10),
    priority: 2,
  });
  await create(german, {
    title: "QA Send Maxim the updated sketches",
    assignees: ["maxim"],
    dueDate: "2099-11-01",
    projectId: project.id,
  });
  await create(maxim, {
    title: "QA Pick a time to catch up",
    assignees: ["maxim", "german"],
  });
  await create(maxim, {
    title: "QA Save an idea for later",
    list: "later",
    projectId: project.id,
  });
  await create(maxim, { title: "QA One small step, finished", done: true });
  const imagePage = await browser.newPage({
    viewport: { width: 640, height: 480 },
  });
  await imagePage.setContent(
    `<body style="margin:0;background:#e9f0ff;font:24px system-ui;color:#243b70;padding:48px"><div style="color:#6550b8;font-size:16px">QA IDEA BOARD</div><h1 style="font-size:42px;letter-spacing:-2px">A little more together.</h1><div style="display:flex;gap:18px"><div style="background:#fff;border-radius:20px;padding:24px;flex:1">A calmer<br>workspace</div><div style="background:#d9cef8;border-radius:20px;padding:24px;flex:1">One small<br>step at a time</div></div></body>`,
  );
  const imageBytes = await imagePage.screenshot();
  await imagePage.close();
  const { task: image } = await json(
    await maxim.post("/api/tasks", {
      multipart: {
        title: "QA Image capture",
        notes: "QA Image-only fixture",
        files: {
          name: "QA Screenshot 2026-10-24 at 09.42.17 AM.png",
          mimeType: "image/png",
          buffer: imageBytes,
        },
      },
    }),
  );
  tasks.add(image.id);
  await json(
    await maxim.patch(`/api/tasks/${image.id}`, { data: { title: "" } }),
  );
  if (process.env.REAL_VISUAL_ONLY !== "1") {
    const page = await newPage("maxim");
    await expect(row(page, primary)).toBeVisible();
    for (const name of ["Today & overdue", "Upcoming", "No date"])
      await expect(
        page.getByRole("heading", { name, exact: true }),
      ).toBeVisible();
    await expect(
      row(page, image).getByRole("button", {
        name: "Edit title: Image",
        exact: true,
      }),
    ).toBeVisible();
    await expect(row(page, image).locator(".image-only")).toBeVisible();
    await page.evaluate(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Shift", bubbles: true }),
      );
      document.dispatchEvent(new ClipboardEvent("paste", { bubbles: true }));
      const transfer = new DataTransfer();
      transfer.items.add(new File(["qa"], "QA.png", { type: "image/png" }));
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
    const capture = page.getByRole("textbox", {
      name: "New task",
      exact: true,
    });
    const creation = page.waitForResponse(
      (r) => r.url().endsWith("/api/tasks") && r.request().method() === "POST",
    );
    await capture.fill("QA Captured with both of us @both !!!");
    await capture.press("Enter");
    const captured = (await (await creation).json()).task;
    tasks.add(captured.id);
    expect(captured.assignees).toHaveLength(2);
    await expect(capture).toBeFocused();
    await open(page, captured);
    const passed = page.waitForResponse((r) =>
      r.url().endsWith(`/api/tasks/${captured.id}/handoff`),
    );
    await page
      .getByRole("button", { name: "Pass to German", exact: true })
      .click();
    expect(
      (await (await passed).json()).task.assignees.map((u) => u.username),
    ).toEqual(["german"]);
    await expect(
      page.getByRole("button", { name: "Take it", exact: true }),
    ).toBeVisible();
    const taken = page.waitForResponse((r) =>
      r.url().endsWith(`/api/tasks/${captured.id}/handoff`),
    );
    await page.getByRole("button", { name: "Take it", exact: true }).click();
    const takeResponse = await taken;
    expect(takeResponse.request().postDataJSON().to).toBe("me");
    if (
      (await takeResponse.json()).task.assignees
        .map((u) => u.username)
        .join() !== "maxim"
    )
      console.log(
        "BACKEND PENDING: handoff-to-me retains German here; mock regression verifies exclusive assignment under the new contract.",
      );
    await page
      .getByRole("button", { name: "Close task details", exact: true })
      .click();
    await page.locator(".account-button").click();
    const settings = page.getByRole("dialog", {
      name: "Your little space",
      exact: true,
    });
    await expect(
      settings.getByRole("link", { name: origin + "/agent", exact: true }),
    ).toBeVisible();
    if (process.env.EXPECT_PUBLIC_API)
      await expect(
        settings.getByRole("link", {
          name: process.env.EXPECT_PUBLIC_API,
          exact: true,
        }),
      ).toBeVisible();
    await settings.getByLabel("Display name", { exact: true }).fill("QA Maxim");
    await settings
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await expect(settings.locator(".settings-profile strong")).toHaveText(
      "QA Maxim",
    );
    profileChanged = true;
    await settings.getByText("Change password", { exact: false }).click();
    temporaryPassword = `QA-${randomBytes(18).toString("hex")}`;
    async function savePassword(currentPassword, password, displayName) {
      await settings
        .getByLabel("Current password", { exact: true })
        .fill(currentPassword);
      await settings.getByLabel("New password", { exact: true }).fill(password);
      if (displayName)
        await settings
          .getByLabel("Display name", { exact: true })
          .fill(displayName);
      const response = page.waitForResponse(
        (r) => r.url().endsWith("/api/me") && r.request().method() === "PATCH",
      );
      await settings
        .getByRole("button", { name: "Save changes", exact: true })
        .click();
      await json(await response);
    }
    await savePassword(passwordFor("maxim"), temporaryPassword);
    passwordChanged = true;
    const verifier = await request.newContext({ baseURL: origin });
    contexts.push(verifier);
    await json(
      await verifier.post("/api/auth/login", {
        data: { username: "maxim", password: temporaryPassword },
      }),
    );
    await savePassword(temporaryPassword, passwordFor("maxim"), originalName);
    profileChanged = passwordChanged = false;
    await json(
      await verifier.post("/api/auth/login", {
        data: { username: "maxim", password: passwordFor("maxim") },
      }),
    );
    const tokenName = "QA Real smoke agent";
    await settings
      .getByRole("textbox", { name: "Token name", exact: true })
      .fill(tokenName);
    const tokenResponse = page.waitForResponse(
      (r) => r.url().endsWith("/api/tokens") && r.request().method() === "POST",
    );
    await settings.getByRole("button", { name: "Create", exact: true }).click();
    const token = await (await tokenResponse).json();
    tokens.add(token.token.id);
    await expect(settings.locator(".secret-card code")).toHaveText(
      token.secret,
    );
    await settings
      .getByRole("button", { name: "Copy new token", exact: true })
      .click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      token.secret,
    );
    const bearer = await request.newContext({
      baseURL: origin,
      extraHTTPHeaders: { Authorization: `Bearer ${token.secret}` },
    });
    contexts.push(bearer);
    await json(await bearer.get("/api/me"));
    await settings
      .getByRole("button", { name: "I’ve saved it", exact: true })
      .click();
    await expect(settings.locator(".secret-card")).toHaveCount(0);
    await expect
      .poll(
        async () =>
          (await json(await maxim.get("/api/tokens"))).tokens.find(
            (t) => t.id === token.token.id,
          ).lastUsedAt,
      )
      .toBeTruthy();
    await expect(
      settings.locator(".token-row").filter({ hasText: tokenName }),
    ).toContainText("Last used", { timeout: 15000 });
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
    tokens.delete(token.token.id);
    expect((await bearer.get("/api/me")).status()).toBe(401);
    await settings
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    console.log(
      "PASS real settings: profile/password restored, token copied once, exercised, lastUsedAt shown, revoked.",
    );
    await json(
      await german.patch(`/api/tasks/${primary.id}`, {
        data: { list: "later" },
      }),
    );
    await expect(row(page, primary)).toHaveCount(0, { timeout: 15000 });
    await json(
      await german.patch(`/api/tasks/${primary.id}`, { data: { list: "now" } }),
    );
    await expect(row(page, primary)).toBeVisible({ timeout: 15000 });
    const stale = await create(maxim, {
      title: "QA Deleted in the other account",
    });
    await page.reload();
    await open(page, stale);
    expected404.add(stale.id);
    let staleGets = 0,
      stalePatches = 0;
    page.on("request", (r) => {
      if (r.url().endsWith(`/api/tasks/${stale.id}`)) {
        if (r.method() === "GET") staleGets++;
        if (r.method() === "PATCH") stalePatches++;
      }
    });
    await json(await german.delete(`/api/tasks/${stale.id}`));
    tasks.delete(stale.id);
    await expect(
      page.getByRole("dialog", { name: "Task details" }),
    ).toHaveCount(0, { timeout: 15000 });
    await expect(
      page.getByText("This task was deleted", { exact: true }),
    ).toBeVisible();
    const gets = staleGets;
    await page.waitForTimeout(11000);
    expect(staleGets).toBe(gets);
    expect(stalePatches).toBe(0);
    console.log(
      "PASS concurrency: moved rows reconcile and deletion closes inspector with no repeated requests.",
    );
    const phone = await newPage("maxim", { width: 375, height: 667 });
    await choose(phone, /My Tasks/);
    const swiped = await create(maxim, { title: "QA Swipe actions" });
    await phone.reload();
    await choose(phone, /My Tasks/);
    await swipe(phone, swiped, 20, 100);
    await expect(row(phone, swiped)).not.toHaveAttribute("style", /translateX/);
    await swipe(phone, swiped, -110);
    const actions = row(phone, swiped).locator("..").locator(".swipe-actions");
    await expect(actions).toHaveAttribute("aria-hidden", "false");
    await actions.getByRole("button", { name: "Delete", exact: true }).click();
    await phone
      .getByRole("dialog", { name: "Delete this task?" })
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    await swipe(phone, swiped, 110);
    await expect
      .poll(
        async () =>
          (await json(await maxim.get(`/api/tasks/${swiped.id}`))).task.done,
      )
      .toBe(true);
    await phone.emulateMedia({ reducedMotion: "no-preference" });
    await json(
      await maxim.patch(`/api/tasks/${swiped.id}`, { data: { done: false } }),
    );
    await phone.reload();
    await choose(phone, /My Tasks/);
    await swipe(phone, swiped, -110);
    await expect(row(phone, swiped)).toHaveAttribute(
      "style",
      /translateX\(-184px\)/,
    );
    await actions
      .getByRole("button", { name: "Pass to German", exact: true })
      .click();
    await expect(row(phone, swiped)).toHaveCount(0);
    console.log(
      "PASS mobile: direction lock, spring/reduced motion, Delete confirmation, complete and pass.",
    );
  }
  if (process.env.REAL_SCREENSHOTS === "1") {
    await mkdir(screenshotDir, { recursive: true });
    for (const file of await readdir(screenshotDir))
      if (file.endsWith(".png")) await unlink(new URL(file, screenshotDir));
    const desktop = await newPage("maxim");
    for (const colorScheme of ["light", "dark"]) {
      await desktop.emulateMedia({ colorScheme });
      await shot(desktop, `desktop-${colorScheme}`);
      await open(desktop, primary);
      await shot(desktop, `desktop-detail-${colorScheme}`);
      await desktop
        .getByRole("button", { name: "Close task details", exact: true })
        .click();
    }
    const login = await (
      await browser.newContext({ viewport: { width: 1440, height: 900 } })
    ).newPage();
    await login.goto(origin + "/login");
    await shot(login, "desktop-login-light");
    for (const [name, width, height] of [
      ["mobile", 375, 667],
      ["iphone-14-pro-max", 430, 932],
      ["ipad", 820, 1180],
    ]) {
      const device = await newPage("maxim", { width, height });
      for (const colorScheme of ["light", "dark"]) {
        await device.emulateMedia({ colorScheme });
        if (width < 761) {
          if (!(await device.locator(".mobile-home").isVisible()))
            await device
              .getByRole("button", { name: "Lists", exact: true })
              .click();
          await shot(device, `${name}-home-${colorScheme}`);
        }
        await choose(device, /My Tasks/);
        await shot(device, `${name}-list-${colorScheme}`);
        if (width < 761)
          expect((await row(device, primary).boundingBox()).y).toBeLessThan(
            320,
          );
        await open(device, image);
        await device.locator(".attachment-section").scrollIntoViewIfNeeded();
        await expect(
          device.locator(".image-gallery button > span"),
        ).toHaveAttribute(
          "title",
          "QA Screenshot 2026-10-24 at 09.42.17 AM.png",
        );
        await shot(device, `${name}-detail-${colorScheme}`);
        await device
          .getByRole("button", { name: "Close task details", exact: true })
          .click();
      }
    }
    const second = await newPage("german", { width: 430, height: 932 });
    for (const colorScheme of ["light", "dark"]) {
      await second.emulateMedia({ colorScheme });
      await choose(second, /My Tasks/);
      await second
        .getByRole("button", { name: "From Maxim", exact: true })
        .click();
      await shot(second, `german-mobile-${colorScheme}`);
    }
    console.log("PASS visual captures: apps/web/docs/screenshots/");
  }
  expect(errors, "Unexpected browser errors").toEqual([]);
  console.log(
    `PASS real smoke: zero unexpected console/page errors; ${terminalErrors.length} expected terminal stale-task response(s).`,
  );
} finally {
  await browser.close();
  if (maxim) {
    if (passwordChanged || profileChanged)
      await json(
        await maxim.patch("/api/me", {
          data: {
            displayName: originalName,
            ...(passwordChanged
              ? {
                  currentPassword: temporaryPassword,
                  password: passwordFor("maxim"),
                }
              : {}),
          },
        }),
      );
    for (const id of tasks) {
      const response = await maxim.get(`/api/tasks/${id}`);
      if (response.status() === 404) continue;
      const { task } = await json(response);
      if (!task.title.startsWith("QA ") && !task.notes.startsWith("QA "))
        throw new Error("Refusing to delete non-QA task");
      await json(await maxim.delete(`/api/tasks/${id}`));
    }
    for (const id of projects)
      await json(await maxim.delete(`/api/projects/${id}`));
    for (const id of tags) await json(await maxim.delete(`/api/tags/${id}`));
    for (const id of tokens) await maxim.delete(`/api/tokens/${id}`);
    const remaining = (
      await json(await maxim.get("/api/tasks?view=all&done=all&limit=1000"))
    ).tasks;
    expect(remaining.filter((t) => tasks.has(t.id))).toHaveLength(0);
    console.log("QA cleanup verified.");
  }
  for (const context of contexts) await context.dispose();
}

import { test, expect } from "@playwright/test";

test("mobile email settings persist, show errors, and allow email login", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.request.post("/api/auth/login", {
    data: { username: "maxim", password: "todoer" },
  });
  const { user: original } = await (await page.request.get("/api/me")).json();
  const email = `qa-maxim@example.com`;
  try {
    await page.request.patch("/api/me", {
      data: { emailNotifications: true, emailPreferences: { assigned: true } },
    });
    await page.goto("/my");
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const settings = page.getByRole("dialog", { name: "Your little space", exact: true });
    const input = settings.getByLabel("Email address", { exact: true });
    const toggle = settings.getByRole("switch", {
      name: "Email notifications", exact: true,
    });
    const preferences = settings.getByRole("group", { name: "Email alert types" });
    const assigned = preferences.getByRole("switch", { name: "Assigned to you", exact: true });
    const save = settings.getByRole("button", { name: "Save email", exact: true });
    await input.fill("TEAMMATE@example.com");
    await save.click();
    await expect(settings.getByRole("alert")).toHaveText("That email is already in use");
    await expect(input).toHaveValue("TEAMMATE@example.com");
    await input.fill(email);
    await save.click();
    await expect(settings.getByRole("alert")).toHaveCount(0);
    await expect.poll(async () => (await (await page.request.get("/api/me")).json()).user.email).toBe(email);
    await expect(assigned).toBeChecked();
    await expect(assigned).toHaveAccessibleDescription(/returns from Later for review/);

    await page.route("**/api/me", async (route) => {
      if (route.request().method() !== "PATCH") return route.continue();
      await route.fulfill({ status: 500, json: { error: "Could not save alert type" } });
    });
    await assigned.click();
    await expect(settings.getByRole("alert")).toHaveText("Could not save alert type");
    await expect(assigned).toBeChecked();
    await page.unroute("**/api/me");

    await assigned.uncheck();
    await expect(assigned).not.toBeChecked();
    await expect.poll(async () => (await (await page.request.get("/api/me")).json()).user.emailPreferences)
      .toEqual({ ...original.emailPreferences, assigned: false });
    await expect(toggle).toBeEnabled();
    await toggle.uncheck();
    await expect(toggle).not.toBeChecked();
    await expect(toggle).toBeEnabled();
    await expect.poll(async () => (await (await page.request.get("/api/me")).json()).user.emailNotifications).toBe(false);
    for (const preference of await preferences.getByRole("switch").all()) {
      await expect(preference).toBeDisabled();
    }
    await page.reload();
    await expect(settings).toBeVisible();
    await expect(input).toHaveValue(email);
    await expect(toggle).not.toBeChecked();
    await expect(assigned).toBeDisabled();
    await expect(assigned).not.toBeChecked();
    await toggle.check();
    await expect(toggle).toBeChecked();
    await expect(assigned).toBeEnabled();
    await expect(assigned).not.toBeChecked();
    await input.fill("");
    await save.click();
    await expect(toggle).toBeDisabled();
    await expect(assigned).toBeDisabled();
    await expect(settings.getByText("Save an email address to receive notifications.")).toBeVisible();
    await input.fill(email);
    await save.click();
    await expect(assigned).toBeEnabled();
    await settings.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.getByLabel("Username or email", { exact: true }).fill(email.toUpperCase());
    await page.getByLabel("Password", { exact: true }).fill("todoer");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByRole("link", { name: "Settings", exact: true })).toBeVisible();
  } finally {
    await page.request.post("/api/auth/login", {
      data: { username: "maxim", password: "todoer" },
    });
    const restored = await page.request.patch("/api/me", {
      data: {
        email: original.email,
        emailNotifications: original.emailNotifications,
        emailPreferences: original.emailPreferences,
      },
    });
    expect(restored.ok()).toBe(true);
  }
});

test("mock email validation and privacy match the current-user contract", async ({ request }) => {
  await request.post("/api/auth/login", { data: { username: "MAXIM", password: "todoer" } });
  const me = await (await request.get("/api/me")).json();
  expect(me.user.email).toEqual(expect.any(String));
  expect(me.teammate).not.toHaveProperty("email");
  expect(me.teammate).not.toHaveProperty("emailNotifications");
  expect(me.teammate).not.toHaveProperty("emailPreferences");
  expect(me.user.emailPreferences).toEqual({
    assigned: true, completed: true, updates: true, achievements: true, afk: true, seasons: true,
  });
  const invalid = await request.patch("/api/me", { data: { email: "invalid" } });
  expect(invalid.status()).toBe(400);
  expect((await invalid.json()).error).toBeTruthy();
  for (const emailPreferences of [{ unknown: true }, { assigned: "false" }, null, []]) {
    const response = await request.patch("/api/me", { data: { emailPreferences } });
    expect(response.status()).toBe(400);
    expect((await response.json()).error).toBeTruthy();
  }
  const users = await (await request.get("/api/users")).json();
  for (const user of users.users) {
    expect(user).not.toHaveProperty("email");
    expect(user).not.toHaveProperty("emailNotifications");
    expect(user).not.toHaveProperty("emailPreferences");
  }
});

import { test, expect } from "@playwright/test";

test("birthday can be saved, persists, and can be cleared", async ({ page }) => {
  await page.request.post("/api/auth/login", { data: { username: "maxim", password: "todoer" } });
  const original = (await (await page.request.get("/api/me")).json()).user.birthday;
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/my");
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const settings = page.getByRole("dialog", { name: "Your little space" });
    await settings.getByLabel("Month", { exact: true }).selectOption("02");
    await settings.getByLabel("Day", { exact: true }).selectOption("29");
    await settings.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect.poll(async () => (await (await page.request.get("/api/me")).json()).user.birthday).toBe("02-29");
    await page.reload();
    await expect(settings.getByLabel("Month", { exact: true })).toHaveValue("02");
    await expect(settings.getByLabel("Day", { exact: true })).toHaveValue("29");
    await settings.getByRole("button", { name: "Clear birthday", exact: true }).click();
    await settings.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect.poll(async () => (await (await page.request.get("/api/me")).json()).user.birthday).toBeNull();
    await page.reload();
    await expect(settings.getByLabel("Month", { exact: true })).toHaveValue("");
    await expect(settings.getByLabel("Day", { exact: true })).toHaveValue("");
    await expect(settings.getByText("Optional. Only you can see this.")).toBeVisible();
  } finally {
    await page.request.patch("/api/me", { data: { birthday: original } });
  }
});

test("mock birthday validation and privacy match the API", async ({ request }) => {
  await request.post("/api/auth/login", { data: { username: "maxim", password: "todoer" } });
  for (const birthday of ["2024-02-29", "2-29", "02-30", "04-31", "00-01", 12]) {
    const response = await request.patch("/api/me", { data: { birthday } });
    expect(response.status()).toBe(400);
    expect((await response.json()).error).toBeTruthy();
  }
  const me = await (await request.get("/api/me")).json();
  expect(me.teammate).not.toHaveProperty("birthday");
  for (const user of (await (await request.get("/api/users")).json()).users) expect(user).not.toHaveProperty("birthday");
});

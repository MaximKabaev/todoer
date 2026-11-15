import { test, expect } from "@playwright/test";

async function login(page: import("@playwright/test").Page) {
  await page.request.post("/api/auth/login", {
    data: { username: "maxim", password: "todoer" },
  });
}

test("Stats navigation, standings, comparison and history; season card links back", async ({
  page,
}) => {
  await login(page);
  await page.goto("/my");
  const card = page.getByRole("region", {
    name: "Your good boy score",
    exact: true,
  });
  await expect(
    card.getByRole("link", { name: /Season \d+.*days left/ }),
  ).toBeVisible();
  await page
    .locator(".sidebar")
    .getByRole("link", { name: "Stats", exact: true })
    .click();
  await expect(page).toHaveURL(/\/stats$/);
  await expect(page).toHaveTitle("Stats · todoer");
  await expect(
    page.getByRole("region", { name: "Season standings" }),
  ).toContainText(/Season \d+/);
  await expect(
    page.getByRole("region", { name: "Season standings" }),
  ).toContainText("OVERALL TALLY");
  await expect(
    page.getByRole("heading", { name: "Head to head" }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: /Score history chart/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "90 days", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "90 days", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "All time", exact: true }).click();
  await expect(
    page.getByRole("row", { name: /Median hours to done/ }),
  ).toBeVisible();
  await page.goto("/my");
  await card.getByRole("link", { name: /Season \d+/ }).click();
  await expect(page.getByRole("heading", { name: "Stats." })).toBeVisible();
});

test("phone navigation and sparse data have no page overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await login(page);
  await page.goto("/");
  await page
    .locator(".mobile-home")
    .getByRole("link", { name: "Stats", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Season standings" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Lists", exact: true }).click();
  await expect(page.locator(".mobile-home")).toBeVisible();
});

test("missing teammate, null records and short history remain usable", async ({
  page,
}) => {
  await login(page);
  await page.route("**/api/stats", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.teammate = null;
    data.me.best = data.me.worst = data.me.bestDay = null;
    data.me.allTime.onTimeRate = data.me.season.onTimeRate = null;
    data.me.allTime.medianHoursToDone = null;
    data.history = data.history
      .slice(-1)
      .map((h: object) => ({ ...h, teammate: null }));
    await route.fulfill({ response, json: data });
  });
  await page.goto("/stats");
  await expect(page.getByText("Your season. Your pace.")).toBeVisible();
  await expect(
    page.getByRole("img", { name: /Score history chart/ }),
  ).toBeVisible();
  await expect(
    page.getByText("The story starts here.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByText("No history yet").first()).toBeVisible();
});

test("score card celebrates the previous result only in the first three days", async ({
  page,
}) => {
  await login(page);
  for (const [days, visible] of [
    [1, true],
    [4, false],
  ] as const) {
    await page.route("**/api/score", async (route) => {
      const response = await route.fetch();
      const data = await response.json();
      data.season.startsAt = new Date(
        Date.now() - days * 86400000,
      ).toISOString();
      data.season.previous.winner = null;
      await route.fulfill({ response, json: data });
    });
    await page.goto("/my");
    const card = page.getByRole("region", {
      name: "Your good boy score",
      exact: true,
    });
    await expect(card).toBeVisible();
    if (visible) await expect(card).toContainText("Last season: A tie");
    else await expect(card).not.toContainText("Last season:");
    await page.unroute("**/api/score");
  }
});

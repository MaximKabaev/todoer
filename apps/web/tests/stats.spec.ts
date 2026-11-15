import { test, expect } from "@playwright/test";

async function login(page: import("@playwright/test").Page) {
  await page.request.post("/api/auth/login", {
    data: { username: "maxim", password: "todoer" },
  });
}

test("Stats navigation, standings, comparison and history; the score card has no season line", async ({
  page,
}) => {
  await login(page);
  await page.goto("/my");
  const card = page.getByRole("region", {
    name: "Your good boy score",
    exact: true,
  });
  await expect(card).toBeVisible();
  await expect(card).not.toContainText(/Season \d+/);
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

async function exactStats(page: import("@playwright/test").Page) {
  await login(page);
  await page.route("**/api/stats", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.me.activity[0] = {
      day: "2026-11-11",
      completed: 3,
      commits: 12,
      merges: 1,
    };
    data.me.activity[1] = {
      day: "2026-11-12",
      completed: 0,
      commits: 0,
      merges: 0,
    };
    data.me.activity[7] = {
      day: "2026-11-18",
      completed: 1,
      commits: 1,
      merges: 2,
    };
    data.me.weekdays = [21, 1, 0, 3, 4, 5, 6];
    data.me.hours[14] = 3;
    data.me.hours[23] = 1;
    data.history = [
      { day: "2026-11-11", me: 45, teammate: 56 },
      { day: "2026-11-12", me: 47, teammate: 58 },
      { day: "2026-11-13", me: 49, teammate: null },
    ];
    await route.fulfill({ response, json: data });
  });
  await page.goto("/stats");
}

test("chart tooltips show exact values on hover and support roving keyboard focus", async ({
  page,
}) => {
  await exactStats(page);
  const heat = page.getByRole("group", {
    name: /Maxim daily activity heatmap/,
  });
  const cells = heat.getByRole("button");
  const tooltip = page.getByRole("tooltip");
  await cells.first().hover();
  await expect(tooltip).toHaveText(
    "Wed, Nov 11 · 3 tasks completed · 12 commits · 1 merged PR",
  );
  await expect(cells).toHaveCount(182);
  await cells.first().focus();
  await expect(heat.locator('[tabindex="0"]')).toHaveCount(1);
  await page.keyboard.press("ArrowDown");
  await expect(cells.nth(1)).toBeFocused();
  await expect(tooltip).toHaveText("Thu, Nov 12 · No activity");
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  await expect(cells.nth(7)).toBeFocused();
  await expect(tooltip).toHaveText(
    "Wed, Nov 18 · 1 task completed · 1 commit · 2 merged PRs",
  );
  await page.keyboard.press("Escape");
  await expect(tooltip).toHaveCount(0);
  const weekdays = page
    .getByRole("group", { name: "Completions by weekday", exact: true })
    .first();
  await weekdays.getByRole("button").first().hover();
  await expect(tooltip).toHaveText("Mondays · 21 tasks completed");
  await weekdays.getByRole("button").nth(1).focus();
  await expect(tooltip).toHaveText("Tuesdays · 1 task completed");
  await weekdays.getByRole("button").nth(2).hover();
  await expect(tooltip).toHaveText("Wednesdays · 0 tasks completed");
  const hours = page
    .getByRole("group", { name: "Completions by hour", exact: true })
    .first();
  await hours.getByRole("button").nth(14).hover();
  await expect(tooltip).toHaveText("14:00–15:00 · 3 tasks completed");
  await hours.getByRole("button").nth(23).hover();
  await expect(tooltip).toHaveText("23:00–24:00 · 1 task completed");
  const history = page.getByRole("img", { name: /Score history chart/ });
  await history.hover();
  await expect(tooltip).toHaveText("Thu, Nov 12 · Maxim: 47 · Teammate: 58");
  await expect(page.getByTestId("history-guide")).toHaveCount(1);
  await expect(page.getByTestId("history-guide")).toHaveAttribute(
    "stroke",
    "var(--secondary)",
  );
  await history.locator("..").focus();
  await page.keyboard.press("End");
  await expect(tooltip).toHaveText(
    "Fri, Nov 13 · Maxim: 49 · Teammate: No score",
  );
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("history-guide")).toHaveCount(0);
});

test.describe("touch tooltips", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    colorScheme: "dark",
    reducedMotion: "reduce",
  });
  test("tap shows values, stays inside the viewport, and outside taps reach controls", async ({
    page,
  }) => {
    await exactStats(page);
    const targets = [
      page
        .getByRole("group", { name: /Maxim daily activity heatmap/ })
        .getByRole("button")
        .first(),
      page
        .getByRole("group", { name: "Completions by hour", exact: true })
        .first()
        .getByRole("button")
        .nth(14),
      page.getByRole("img", { name: /Score history chart/ }),
    ];
    for (const [i, target] of targets.entries()) {
      await target.tap();
      const tooltip = page.getByRole("tooltip");
      await expect(tooltip).toHaveText(
        [
          "Wed, Nov 11 · 3 tasks completed · 12 commits · 1 merged PR",
          "14:00–15:00 · 3 tasks completed",
          "Thu, Nov 12 · Maxim: 47 · Teammate: 58",
        ][i],
      );
      const box = await tooltip.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(390);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      // A real outside control must still receive the tap.
      await page.getByRole("button", { name: "90 days", exact: true }).tap();
      await expect(tooltip).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "90 days", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
    }
  });
});

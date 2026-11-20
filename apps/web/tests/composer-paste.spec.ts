import { test, expect } from "@playwright/test";

const pixel = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("pasting an image keeps the typed text as the task title", async ({
  page,
}) => {
  await page.request.post("/api/auth/login", {
    data: { username: "maxim", password: "todoer" },
  });
  await page.goto("/my");
  const input = page.getByRole("textbox", { name: "New task", exact: true });
  await input.fill("QA paste keeps text #qa-paste");
  const created = page.waitForResponse(
    (r) => r.url().endsWith("/api/tasks") && r.request().method() === "POST",
  );
  await page.evaluate((bytes) => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([Uint8Array.from(bytes)], "pixel.png", { type: "image/png" }),
    );
    document
      .querySelector('input[aria-label="New task"]')!
      .dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true }),
      );
  }, [...pixel]);
  const { task } = await (await created).json();
  try {
    expect(task.title).toBe("QA paste keeps text");
    expect(task.tags.map((t: { name: string }) => t.name)).toContain(
      "qa-paste",
    );
    expect(task.attachments).toHaveLength(1);
    await expect(input).toHaveValue("");
  } finally {
    await page.request.delete(`/api/tasks/${task.id}`);
  }
});

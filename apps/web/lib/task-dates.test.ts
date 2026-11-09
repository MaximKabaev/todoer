import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultDueDate, showDueChip, transitionDueDate } from "./task-dates";
import { parseQuickSyntax } from "./quick-syntax";
import { workspaceKey } from "./api";

test("seven day defaults cross months; explicit null survives transitions", () => {
  assert.equal(defaultDueDate("2026-12-28"), "2027-01-04");
  const later = { list: "later" as const, dueDate: "2026-01-01" };
  assert.equal(transitionDueDate(later, {}, "now", "2026-11-09"), "2026-11-16");
  assert.equal(transitionDueDate(later, { dueDate: null }, "now", "2026-11-09"), null);
  assert.equal(transitionDueDate({ ...later, list: "now" }, {}, "now", "2026-11-09"), "2026-01-01");
});
test("rows show open deadlines through three days away, and hide distant/done dates", () => {
  const chip = (dueDate: string | null, done = false) => showDueChip({ dueDate, done }, "2026-11-09");
  assert.ok(chip("2026-11-08"));
  assert.ok(chip("2026-11-12"));
  assert.equal(chip("2026-11-13"), false);
  assert.equal(chip("2026-11-09", true), false);
  assert.equal(chip(null), false);
});
test("capture omits dueDate and score participates in workspace refresh", () => {
  assert.equal(Object.hasOwn(parseQuickSyntax("hello", [{ id: "1", username: "maxim", displayName: "Maxim", color: "blue" }, { id: "2", username: "german", displayName: "German", color: "orange" }]).fields, "dueDate"), false);
  assert.ok(workspaceKey("/api/score"));
});

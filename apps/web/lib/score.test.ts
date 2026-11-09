import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreAt, scoreEntry, deadline } from "../scripts/mock-score.mjs";
import { scoreComparison } from "./score";
import type { Score } from "./api";
const user = { id: "me", username: "maxim", displayName: "Maxim", color: "blue" as const };
const now = Date.parse("2026-11-09T12:00:00Z");
const task = { id: "a", title: "Task", notes: "", createdAt: "2026-11-01T12:00:00Z", dueDate: "2026-11-08", priority: 0, list: "now", assignees: [user], done: false, doneAt: null as string | null };
test("mock scores prior, open overdue, on-time, late and quick completion", () => {
  assert.equal(scoreAt([], now), 50);
  assert.equal(scoreAt([task], now), 50); // first late day grade = prior
  assert.equal(scoreAt([{ ...task, dueDate: "2026-11-01" }], now), 42);
  assert.equal(scoreAt([{ ...task, done: true, doneAt: "2026-11-08T12:00:00Z" }], now), 58);
  assert.equal(scoreAt([{ ...task, done: true, doneAt: "2026-11-09T01:00:00Z" }], now), 55);
  assert.equal(scoreAt([{ ...task, done: true, doneAt: "2026-11-01T12:01:00Z" }], now), 52);
  assert.equal(scoreAt([{ ...task, title: "", notes: "" }], now), 50);
  assert.equal(scoreAt([{ ...task, createdAt: "2026-11-10T00:00:00Z" }], now), 50);
});
test("historical score treats future completion as open; counts are per assigned Now person", () => {
  const done = { ...task, done: true, doneAt: "2026-11-09T10:00:00Z" };
  assert.equal(scoreAt([done], Date.parse("2026-11-09T09:00:00Z")), 50);
  const entry = scoreEntry([done, { ...task, list: "later" }], user, now);
  assert.equal(entry.doneThisWeek, 1);
  assert.equal(entry.overdue, 0);
  assert.equal(entry.trend, 5);
  assert.equal(deadline({ ...task, dueDate: null }), Date.parse("2026-11-09T00:00:00Z"));
});
test("comparison is relative to the viewed person", () => {
  const entry = scoreEntry([], user, now);
  const score: Score = { me: entry, teammate: { ...entry, user: { ...user, id: "other", displayName: "German" } }, leader: "teammate", lead: 4 };
  assert.equal(scoreComparison(score, "me"), "German leads by 4");
  assert.equal(scoreComparison(score, "teammate"), "German leads you by 4");
  assert.equal(scoreComparison({ ...score, leader: "me" }, "teammate"), "You lead German by 4");
  assert.equal(scoreComparison({ ...score, leader: null, lead: 0 }, "me"), "Neck and neck");
});
test("priority, the ten-minute boundary and capped evidence weight match the contract", () => {
  const done = { ...task, priority: 3, done: true, doneAt: "2026-11-08T12:00:00Z" };
  assert.equal(scoreAt([done], now), 67);
  assert.equal(scoreAt([{ ...done, createdAt: "2026-11-08T11:50:01Z" }], now), 56);
  assert.equal(scoreAt([{ ...done, createdAt: "2026-11-08T11:50:00Z" }], now), 67);
  const many = Array.from({ length: 8 }, (_, i) => ({ ...done, id: String(i) }));
  assert.equal(scoreAt(many, now), 92);
  assert.equal(scoreEntry(many, user, now).label, "Best boy ever");
  assert.equal(scoreEntry([{ ...done, list: "later" }, { ...done, assignees: [] }], user, now).score, 50);
});

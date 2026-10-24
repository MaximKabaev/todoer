import { test } from "node:test";
import assert from "node:assert/strict";
import { taskAssignment } from "./task-assignment";
import type { Task, User } from "./api";

const me: User = {
  id: "1",
  username: "maxim",
  displayName: "Maxim",
  color: "blue",
};
const other: User = {
  id: "2",
  username: "german",
  displayName: "German",
  color: "orange",
};
const resolve = (id: string) =>
  ["me", "maxim", "1"].includes(id) ? me : other;
const now: Pick<Task, "list" | "assignees"> = {
  list: "now",
  assignees: [me, other],
};
const later: Pick<Task, "list" | "assignees"> = {
  list: "later",
  assignees: [],
};

test("moving to Later clears assignment and wins over same-request assignments", () => {
  assert.deepEqual(
    taskAssignment(
      now,
      { list: "later", assignees: ["me"], addAssignees: ["2"] },
      resolve,
    ),
    later,
  );
});
test("assignment and handoff plan Later tasks optimistically", () => {
  for (const input of [
    { assignees: ["me"] },
    { addAssignees: ["me"] },
    { list: "now" as const, assignees: ["me"] },
  ])
    assert.deepEqual(taskAssignment(later, input, resolve), {
      list: "now",
      assignees: [me],
    });
});
test("the Now toggle leaves a Later task unassigned", () => {
  assert.deepEqual(taskAssignment(later, { list: "now" }, resolve), {
    list: "now",
    assignees: [],
  });
  assert.deepEqual(taskAssignment(later, { assignees: [] }, resolve), later);
  assert.deepEqual(
    taskAssignment(later, { title: "Still an idea" }, resolve),
    later,
  );
});
test("assignment additions deduplicate and removals resolve user aliases", () => {
  assert.deepEqual(
    taskAssignment(
      now,
      { addAssignees: ["me"], removeAssignees: ["german"] },
      resolve,
    ),
    { list: "now", assignees: [me] },
  );
});

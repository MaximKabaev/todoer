import { test } from "node:test";
import assert from "node:assert/strict";
import {
  safeNext,
  normalizeAppUrl,
  selectionUrl,
  parseListUrl,
  taskBackground,
} from "./routes";
import type { Task, User } from "./api";
const me: User = {
  id: "me",
  username: "german",
  displayName: "German",
  color: "orange",
};
const other: User = {
  id: "other",
  username: "maxim",
  displayName: "Maxim",
  color: "blue",
};
test("login next rejects external and browser-normalized redirects", () => {
  for (const next of [
    null,
    "",
    "//evil.com",
    "https://evil.com",
    "/\\evil.com",
    "/ /evil.com",
    "/\nevil.com",
    "/login?next=/later",
  ])
    assert.equal(safeNext(next), "/");
  assert.equal(safeNext("/tasks/abc?x=1"), "/tasks/abc?x=1");
});
test("list URLs preserve names, usernames, segments and search", () => {
  assert.equal(selectionUrl({ kind: "teammate" }, other), "/people/maxim");
  for (const [i, show] of [
    "",
    "?show=created",
    "?show=from-teammate",
  ].entries()) {
    const url = selectionUrl({ kind: "mine" }, other, i);
    assert.equal(url, `/my${show}`);
    assert.equal(parseListUrl(url).segment, i);
  }
  const url = selectionUrl({ kind: "tag", id: "QA / café #" }, other);
  assert.equal(parseListUrl(url).selection.id, "QA / café #");
  assert.equal(parseListUrl("/search?q=hello%20world").search, "hello world");
});
test("direct task backgrounds honor assignment, then Later/project/unassigned", () => {
  const task = {
    assignees: [me, other],
    list: "later",
    projectId: "project",
  } as Task;
  assert.equal(taskBackground(task, me), "/my");
  assert.equal(
    taskBackground({ ...task, assignees: [other] }, me),
    "/people/maxim",
  );
  assert.equal(taskBackground({ ...task, assignees: [] }, me), "/later");
  assert.equal(
    taskBackground({ ...task, assignees: [], list: "now" }, me),
    "/projects/project",
  );
  assert.equal(
    taskBackground(
      { ...task, assignees: [], list: "now", projectId: null },
      me,
    ),
    "/unassigned",
  );
});

test("history URLs normalize equivalent query encodings", () => {
  assert.equal(normalizeAppUrl("/search?q=QA%20shared"), "/search?q=QA+shared");
  assert.equal(normalizeAppUrl("/my?show=created"), "/my?show=created");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseQuickSyntax } from "./quick-syntax";
import type { User } from "./api";
const users: [User, User] = [
  { id: "1", username: "maxim", displayName: "Maxim", color: "blue" },
  { id: "2", username: "teammate", displayName: "Alex Smith", color: "orange" },
];
test("plain text and unknown mentions survive capture", () => {
  assert.equal(
    parseQuickSyntax("Call @someone at 5! hello@example.com", users).title,
    "Call @someone at 5! hello@example.com",
  );
});
test("all quick syntax becomes structured fields", () => {
  const result = parseQuickSyntax(
    "Review the layout #design @both !!! ^later",
    users,
  );
  assert.equal(result.title, "Review the layout");
  assert.deepEqual(result.fields, {
    tags: ["design"],
    assignees: ["1", "2"],
    priority: 3,
    list: "later",
  });
});
test("display names, usernames and unicode tags work", () => {
  assert.deepEqual(parseQuickSyntax("Check @Alex Smith #идея", users).fields, {
    assignees: ["2"],
    tags: ["идея"],
  });
  assert.deepEqual(parseQuickSyntax("@MAXIM", users).fields.assignees, ["1"]);
});
test("empty title and punctuation are safe", () => {
  assert.equal(parseQuickSyntax("", users).title, "");
  assert.equal(parseQuickSyntax("Wow!!!!", users).title, "Wow!!!!");
});
test("relative @teammate wins over the signed-in username teammate", () => {
  const reversed: [User, User] = [users[1], users[0]];
  assert.deepEqual(
    parseQuickSyntax("Pass this @teammate", reversed).fields.assignees,
    [users[0].id],
  );
  assert.deepEqual(
    parseQuickSyntax("Keep this @me", reversed).fields.assignees,
    [users[1].id],
  );
});

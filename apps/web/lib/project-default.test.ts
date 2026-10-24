import { test } from "node:test";
import assert from "node:assert/strict";
import { captureProjectId, defaultProjectId } from "./project-default";
import type { Project } from "./api";
const projects = ["a", "b"].map((id) => ({ id, name: id, color: "blue", emoji: null, position: 0, createdAt: "" }) as Project);
test("project default waits for catalog and resolves view, remembered, sole, then none", () => {
  assert.equal(defaultProjectId(undefined, "a"), undefined);
  assert.equal(defaultProjectId(projects, "a", "b"), "b");
  assert.equal(defaultProjectId(projects, "a"), "a");
  assert.equal(defaultProjectId(projects, "deleted"), null);
  assert.equal(defaultProjectId([projects[1]], "deleted"), "b");
  assert.equal(defaultProjectId([projects[0]], null), "a");
  assert.equal(defaultProjectId([], "a"), null);
  assert.equal(defaultProjectId(projects, "a", "deleted"), "a");
});
test("one-task overrides respect project views and recover when the chosen project is deleted", () => {
  assert.equal(captureProjectId(projects, "a", undefined, null), null);
  assert.equal(captureProjectId(projects, "a", undefined, "b"), "b");
  assert.equal(captureProjectId(projects, "a", "b", null), "b");
  assert.equal(captureProjectId([projects[0]], "b", undefined, "b"), "a");
  assert.equal(captureProjectId(projects, "a"), "a");
});

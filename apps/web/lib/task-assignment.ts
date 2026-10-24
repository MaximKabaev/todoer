import type { Task, TaskInput, User } from "./api";

// Mirror the API's assignment/list precedence before a mutation reaches it.
export function taskAssignment(
  task: Pick<Task, "list" | "assignees">,
  input: TaskInput,
  resolve: (identifier: string) => User,
): Pick<Task, "list" | "assignees"> {
  if (input.list === "later") return { list: "later", assignees: [] };
  let assignees = input.assignees
    ? input.assignees.map(resolve)
    : task.assignees;
  assignees = [
    ...new Map(
      [...assignees, ...(input.addAssignees || []).map(resolve)].map((u) => [
        u.id,
        u,
      ]),
    ).values(),
  ];
  const removed = new Set(
    (input.removeAssignees || []).map((id) => resolve(id).id),
  );
  assignees = assignees.filter((u) => !removed.has(u.id));
  const assigning = !!(input.assignees?.length || input.addAssignees?.length);
  const list =
    assigning && task.list === "later" ? "now" : input.list || task.list;
  return { list, assignees: list === "later" ? [] : assignees };
}

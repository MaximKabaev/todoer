import type { Task, TaskInput } from "./api";
import { today } from "./utils";

export function defaultDueDate(day = today()) {
  const date = new Date(`${day}T12:00:00`);
  date.setDate(date.getDate() + 7);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function transitionDueDate(
  task: Pick<Task, "list" | "dueDate">,
  input: TaskInput,
  nextList: Task["list"],
  day = today(),
) {
  if (input.dueDate !== undefined) return input.dueDate;
  return task.list === "later" && nextList === "now" && (!task.dueDate || task.dueDate < day)
    ? defaultDueDate(day)
    : task.dueDate;
}
export function showDueChip(task: Pick<Task, "done" | "dueDate">, day: string) {
  if (task.done || !task.dueDate || !day) return false;
  const cutoff = new Date(`${day}T12:00:00`);
  cutoff.setDate(cutoff.getDate() + 3);
  const end = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}-${String(cutoff.getDate()).padStart(2, "0")}`;
  return task.dueDate <= end;
}


export function deadlineNudge(task: Pick<Task, "done" | "list" | "dueDate">, day: string) {
  if (task.list === "later" || !showDueChip(task, day) || !task.dueDate) return null;
  // Compare calendar dates in UTC to avoid 23/25-hour days around DST changes.
  const days = Math.round((Date.parse(`${task.dueDate}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86400000);
  if (days < 0) return {
    level: "overdue",
    label: `${-days} ${days === -1 ? "day" : "days"} overdue`,
    message: "Who’s being a bad boy?",
  };
  if (days === 0) return { level: "today", label: "Due today", message: "Good boys don’t leave it till tomorrow." };
  if (days === 1) return { level: "soon", label: "Due tomorrow", message: "Don’t make us say bad boy." };
  return { level: "soon", label: `Due in ${days} days`, message: "Future you is watching." };
}

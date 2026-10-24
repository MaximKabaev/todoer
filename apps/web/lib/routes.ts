import type { Selection } from "@/hooks/use-workspace";
import type { Task, User } from "./api";

export function safeNext(value: string | null): string {
  // Backslashes and control characters are URL-normalized by browsers too.
  if (
    !value?.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\u0000-\u0020]/.test(value)
  )
    return "/";
  const url = new URL(value, "https://todoer.invalid");
  if (url.origin !== "https://todoer.invalid" || url.pathname === "/login")
    return "/";
  return value;
}

// Match useSearchParams serialization so history entries also match queries with spaces.
export function normalizeAppUrl(value: string): string {
  const url = new URL(value, "https://todoer.invalid");
  const query = url.searchParams.toString();
  return url.pathname + (query ? `?${query}` : "");
}

export function selectionUrl(
  selection: Selection,
  teammate: User,
  segment = 0,
): string {
  if (selection.kind === "mine")
    return (
      ["/my", "/my?show=created", "/my?show=from-teammate"][segment] || "/my"
    );
  if (selection.kind === "teammate")
    return `/people/${encodeURIComponent(teammate.username)}`;
  if (selection.kind === "tag")
    return `/tags/${encodeURIComponent(selection.id!)}`;
  if (selection.kind === "all") return "/search";
  return `/${selection.kind}`;
}

export function parseListUrl(url: string): {
  selection: Selection;
  segment: number;
  search: string;
} {
  const [path, query] = url.split("?");
  const params = new URLSearchParams(query);
  const [kind, rawId] = path.slice(1).split("/");
  const id = rawId ? decodeURIComponent(rawId) : undefined;
  const selection: Selection =
    kind === "tags"
      ? { kind: "tag", id }
      : kind === "people"
        ? { kind: "teammate" }
        : kind === "search"
          ? { kind: "all" }
          : kind === "later" || kind === "unassigned" || kind === "completed"
            ? { kind }
            : { kind: "mine" };
  return {
    selection,
    segment:
      params.get("show") === "created"
        ? 1
        : params.get("show") === "from-teammate"
          ? 2
          : 0,
    search: kind === "search" ? params.get("q") || "" : "",
  };
}

export function taskBackground(task: Task | undefined, viewer: User): string {
  if (!task || task.assignees.some((a) => a.id === viewer.id)) return "/my";
  if (task.assignees.length === 1)
    return `/people/${encodeURIComponent(task.assignees[0].username)}`;
  if (task.list === "later") return "/later";
  return "/unassigned";
}

"use client";
import { useCallback, useRef } from "react";
import useSWR, { useSWRConfig } from "swr";
import {
  api,
  ApiError,
  type Counts,
  type Project,
  type Tag,
  type Task,
  type TaskInput,
  type TaskQuery,
  type User,
  type View,
  taskKey,
} from "@/lib/api";
import { useToast } from "@/components/providers";
export type Selection = { kind: View | "project" | "tag"; id?: string };
export function viewQuery(
  selection: Selection,
  segment: number,
  q: string,
): TaskQuery {
  return {
    ...(selection.kind === "project"
      ? { projectId: selection.id, view: "all" as const }
      : selection.kind === "tag"
        ? { tag: selection.id, view: "all" as const }
        : {
            view:
              selection.kind === "mine"
                ? (["mine", "mine_created", "mine_from_teammate"] as const)[
                    segment
                  ]
                : selection.kind,
          }),
    ...(q ? { q } : {}),
    limit: 1000,
  };
}
export function viewContext(
  selection: Selection,
  user: User,
  teammate: User,
): TaskInput {
  if (selection.kind === "completed")
    return { done: true, assignees: [user.id] };
  if (selection.kind === "teammate") return { assignees: [teammate.id] };
  if (selection.kind === "later") return { list: "later" };
  if (selection.kind === "unassigned") return { assignees: [] };
  if (selection.kind === "project") return { projectId: selection.id };
  if (selection.kind === "tag") return { tags: [selection.id!] };
  return { assignees: [user.id] };
}
type TaskCache = { tasks: Task[] } | { task: Task | null };
export function useWorkspace(
  selection: Selection,
  segment: number,
  q: string,
  user: User,
  teammate: User,
  onMissing: (id: string) => void,
) {
  const { mutate } = useSWRConfig();
  const toast = useToast();
  const query = viewQuery(selection, segment, q);
  const key = taskKey(query);
  const tasks = useSWR<{ tasks: Task[] }>(key);
  const projects = useSWR<{ projects: Project[] }>("/api/projects");
  const tags = useSWR<{ tags: Tag[] }>("/api/tags");
  const counts = useSWR<Counts>("/api/counts");
  const deleted = useRef(new Set<string>());
  const queues = useRef(new Map<string, Promise<unknown>>());
  const versions = useRef(new Map<string, number>());
  const apply = useCallback(
    (id: string, change: (task: Task) => Task | null) =>
      mutate(
        (k) => typeof k === "string" && k.startsWith("/api/tasks"),
        (data: TaskCache | undefined) => {
          if (!data) return data;
          if ("tasks" in data)
            return {
              tasks: data.tasks.flatMap((t) =>
                t.id === id ? [change(t)].filter((t): t is Task => !!t) : [t],
              ),
            };
          return data.task?.id === id ? { task: change(data.task) } : data;
        },
        { revalidate: false },
      ),
    [mutate],
  );
  const refreshMeta = useCallback(
    () =>
      Promise.allSettled(
        ["/api/counts", "/api/projects", "/api/tags"].map((k) => mutate(k)),
      ),
    [mutate],
  );
  const forget = useCallback(
    async (id: string) => {
      if (deleted.current.has(id)) return;
      deleted.current.add(id);
      onMissing(id);
      await apply(id, () => null);
      await mutate(`/api/tasks/${id}`, undefined, { revalidate: false });
      await refreshMeta();
    },
    [apply, mutate, onMissing, refreshMeta],
  );
  const revalidate = useCallback(async () => {
    await mutate((k) => typeof k === "string" && k.startsWith("/api/tasks"));
    await refreshMeta();
  }, [mutate, refreshMeta]);
  function optimistic(task: Task, input: TaskInput): Task {
    const users = [user, teammate];
    const resolve = (identifier: string) =>
      identifier.toLowerCase() === "me"
        ? user
        : identifier.toLowerCase() === "teammate"
          ? teammate
          : users.find((u) =>
              [u.id, u.username, u.displayName].some(
                (x) => x.toLowerCase() === identifier.toLowerCase(),
              ),
            ) || (identifier === "teammate" ? teammate : user);
    return {
      ...task,
      ...input,
      createdBy: task.createdBy,
      project:
        input.projectId !== undefined
          ? projects.data?.projects.find((p) => p.id === input.projectId) ||
            null
          : task.project,
      assignees: input.assignees
        ? input.assignees.map(resolve)
        : task.assignees,
      tags: input.tags
        ? input.tags.map(
            (name) =>
              tags.data?.tags.find(
                (t) =>
                  t.id === name || t.name.toLowerCase() === name.toLowerCase(),
              ) || { id: name, name, color: "gray" },
          )
        : task.tags,
      doneAt:
        input.done !== undefined
          ? input.done
            ? new Date().toISOString()
            : null
          : task.doneAt,
    };
  }
  async function patch(task: Task, input: TaskInput, handoff = false) {
    if (deleted.current.has(task.id))
      throw new ApiError(404, "This task was deleted");
    const version = (versions.current.get(task.id) || 0) + 1;
    versions.current.set(task.id, version);
    await apply(task.id, (t) => optimistic(t, input));
    const operation = (queues.current.get(task.id) || Promise.resolve())
      .catch(() => {})
      .then(() =>
        deleted.current.has(task.id)
          ? Promise.reject(new ApiError(404, "This task was deleted"))
          : handoff
            ? api.handoff(
                task.id,
                input.assignees?.[0] === user.id ? "me" : "teammate",
              )
            : api.updateTask(task.id, input),
      );
    queues.current.set(task.id, operation);
    try {
      const { task: saved } = await operation;
      if (versions.current.get(task.id) === version) {
        await apply(task.id, () => saved);
        await refreshMeta();
      }
      return saved;
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        await forget(task.id);
        throw error;
      }
      if (versions.current.get(task.id) === version) await revalidate();
      toast({
        message:
          error instanceof Error
            ? error.message
            : "Could not save your change.",
        error: true,
      });
      throw error;
    } finally {
      if (versions.current.get(task.id) === version)
        queues.current.delete(task.id);
    }
  }
  async function create(
    input: TaskInput,
    files: File[] = [],
    { quiet = false }: { quiet?: boolean } = {},
  ) {
    const id = `pending-${crypto.randomUUID()}`;
    const stamp = new Date().toISOString();
    const temp = optimistic(
      {
        id,
        title: "",
        notes: "",
        done: false,
        doneAt: null,
        list: "now",
        dueDate: null,
        priority: 0,
        projectId: null,
        project: null,
        createdBy: user,
        assignees: [user],
        tags: [],
        attachments: [],
        position: Date.now(),
        createdAt: stamp,
        updatedAt: stamp,
      },
      input,
    );
    // Also seed the unfiltered view so capture can leave a creator/search filter instantly.
    const captureKeys = [
      ...new Set([key, taskKey(viewQuery(selection, 0, ""))]),
    ];
    for (const captureKey of captureKeys)
      await mutate(
        captureKey,
        (data: { tasks: Task[] } | undefined) => ({
          tasks: [temp, ...(data?.tasks || [])],
        }),
        { revalidate: false },
      );
    try {
      const { task } = await api.createTask(input, files);
      // A long upload can outlive a poll that replaced the optimistic row.
      for (const captureKey of captureKeys)
        await mutate(
          captureKey,
          (data: { tasks: Task[] } | undefined) => ({
            tasks: data?.tasks.some((t) => t.id === id)
              ? data.tasks.map((t) => (t.id === id ? task : t))
              : [task, ...(data?.tasks || []).filter((t) => t.id !== task.id)],
          }),
          { revalidate: false },
        );
      void refreshMeta();
      return task;
    } catch (error) {
      await apply(id, () => null);
      if (!quiet)
        toast({
          message:
            error instanceof Error ? error.message : "Could not create task.",
          error: true,
        });
      throw error;
    }
  }
  async function remove(task: Task) {
    await apply(task.id, () => null);
    try {
      await api.deleteTask(task.id);
      await refreshMeta();
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        await forget(task.id);
        return;
      }
      await revalidate();
      toast({
        message:
          error instanceof Error ? error.message : "Could not delete task.",
        error: true,
      });
    }
  }
  return {
    tasks,
    projects,
    tags,
    counts,
    patch,
    create,
    remove,
    apply,
    forget,
    revalidate,
    refreshMeta,
  };
}

"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { useRouter } from "next/navigation";
import {
  ArrowDownUp,
  ArrowLeft,
  ArrowUpRight,
  Check,
  CheckCheck,
  ImagePlus,
  ListTodo,
  LoaderCircle,
  Search,
  Settings2,
  Sparkles,
  Sun,
  X,
} from "lucide-react";
import {
  api,
  ApiError,
  request,
  type Task,
  type TaskInput,
  type User,
} from "@/lib/api";
import { imageFiles } from "@/lib/utils";
import {
  useWorkspace,
  viewContext,
  type Selection,
} from "@/hooks/use-workspace";
import { Navigation, listDefinitions } from "./navigation";
import { Composer } from "./composer";
import { TaskRow } from "./task-row";
import { TaskDetail } from "./task-detail";
import { Settings } from "./settings";
import { Avatar, Brand, Confirm, Skeleton } from "./ui";
import { useLocalDay } from "@/hooks/use-local-day";
import { useToast } from "./providers";
export function TodoApp() {
  const router = useRouter();
  const { data, error } = useSWR<{ user: User; teammate: User }>("/api/me");
  useEffect(() => {
    if (error instanceof ApiError && error.status === 401)
      router.replace("/login");
  }, [error, router]);
  if (!data || (error instanceof ApiError && error.status === 401))
    return (
      <div className="auth-loading">
        <Brand />
        {error && !(error instanceof ApiError && error.status === 401) ? (
          <p>Couldn’t connect. Check your connection and try again.</p>
        ) : (
          <LoaderCircle className="spin" size={23} />
        )}
      </div>
    );
  return <Workspace user={data.user} teammate={data.teammate} />;
}
function Workspace({ user, teammate }: { user: User; teammate: User }) {
  const day = useLocalDay();
  const [selection, setSelection] = useState<Selection>({ kind: "mine" });
  const [segment, setSegment] = useState(0);
  const [mobileHome, setMobileHome] = useState(true);
  const [settings, setSettings] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deleteTask, setDeleteTask] = useState<Task | null>(null);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [sort, setSort] = useState<"manual" | "priority" | "due">("manual");
  const [sortOpen, setSortOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [overDetail, setOverDetail] = useState(false);
  const dragDepth = useRef(0);
  const [uploading, setUploading] = useState(false);
  const [completing, setCompleting] = useState<Set<string>>(new Set());
  const [completionTimers] = useState(
    () => new Map<string, ReturnType<typeof setTimeout>>(),
  );
  const composer = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const onMissing = useCallback(
    (id: string) => {
      setSelectedId((current) => (current === id ? null : current));
      setDeleteTask((current) => (current?.id === id ? null : current));
      toast({ message: "This task was deleted" });
    },
    [toast],
  );
  const store = useWorkspace(
    selection,
    segment,
    search,
    user,
    teammate,
    onMissing,
  );
  const selected = useSWR<{ task: Task }>(
    selectedId ? `/api/tasks/${selectedId}` : null,
    request,
    {
      shouldRetryOnError: (error) =>
        !(error instanceof ApiError && error.status === 404),
      onError: (error) => {
        if (selectedId && error instanceof ApiError && error.status === 404)
          void store.forget(selectedId);
      },
      fallbackData:
        selectedId && store.tasks.data?.tasks.find((t) => t.id === selectedId)
          ? { task: store.tasks.data.tasks.find((t) => t.id === selectedId)! }
          : undefined,
    },
  );
  const projects = store.projects.data?.projects || [];
  const tags = store.tags.data?.tags || [];
  const lists = listDefinitions(teammate, store.counts.data);
  const currentList = lists.find((l) => l.kind === selection.kind);
  const project = projects.find((p) => p.id === selection.id);
  const tag = tags.find((t) => t.id === selection.id);
  const title =
    currentList?.title ||
    (selection.kind === "project"
      ? project?.name
      : tag
        ? `#${tag.name}`
        : "") ||
    "Tasks";
  const accent = currentList?.color || project?.color || "teal";
  const Icon = currentList?.icon || ListTodo;
  const context = viewContext(selection, user, teammate);
  const subtitle =
    selection.kind === "mine"
      ? "A clear mind starts with a little list."
      : selection.kind === "teammate"
        ? "A little teamwork goes a long way."
        : selection.kind === "later"
          ? "Future changes / things to look at"
          : selection.kind === "completed"
            ? "Small steps. Real progress. Nicely done."
            : selection.kind === "project"
              ? "One little step at a time."
              : selection.kind === "tag"
                ? "Everything with a common thread."
                : "Good ideas, waiting for a person.";
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query), 250);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    const timers = completionTimers;
    return () => {
      timers.forEach(clearTimeout);
    };
  }, [completionTimers]);
  const select = (value: Selection) => {
    setSelection(value);
    setSegment(0);
    setMobileHome(false);
    setSelectedId(null);
    setQuery("");
    setSearch("");
  };
  const create = async (input: TaskInput, open = false) => {
    if (selection.kind === "mine" && segment === 2) setSegment(0);
    if (search || query) {
      setQuery("");
      setSearch("");
    }
    const value = {
      ...context,
      ...input,
      ...(context.tags || input.tags
        ? {
            tags: [
              ...new Set([...(context.tags || []), ...(input.tags || [])]),
            ],
          }
        : {}),
    };
    const task = await store.create(value);
    if (open) setSelectedId(task.id);
    return task;
  };
  async function upload(files: File[], targetId?: string | null) {
    try {
      const valid = imageFiles(files);
      if (!valid.length) return;
      setUploading(true);
      if (targetId) {
        const { task } = await api.attach(targetId, valid);
        await store.apply(targetId, () => task);
      } else {
        const task = await store.create(context, valid);
        setSelectedId(task.id);
        setMobileHome(false);
      }
      toast({
        message: `${valid.length === 1 ? "Image" : `${valid.length} images`} added.`,
      });
    } catch (err) {
      if (targetId && err instanceof ApiError && err.status === 404) {
        await store.forget(targetId);
        return;
      }
      toast({
        message:
          err instanceof Error ? err.message : "Could not upload images.",
        error: true,
      });
    } finally {
      setUploading(false);
      setDragging(false);
      dragDepth.current = 0;
    }
  }
  const liveUpload = useRef(upload);
  useEffect(() => {
    liveUpload.current = upload;
  });
  useEffect(() => {
    function enter(e: DragEvent) {
      if (!e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      dragDepth.current++;
      setDragging(true);
    }
    function over(e: DragEvent) {
      if (!e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      setOverDetail(
        e.target instanceof Element && !!e.target.closest(".task-detail"),
      );
    }
    function leave(e: DragEvent) {
      e.preventDefault();
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (!dragDepth.current) setDragging(false);
    }
    function drop(e: DragEvent) {
      e.preventDefault();
      setDragging(false);
      dragDepth.current = 0;
      if (e.dataTransfer?.files.length)
        void liveUpload.current(Array.from(e.dataTransfer.files));
    }
    function end() {
      setDragging(false);
      dragDepth.current = 0;
    }
    function paste(e: ClipboardEvent) {
      if (
        e.target instanceof Element &&
        e.target.closest("input,textarea,[contenteditable=true]")
      )
        return;
      if (e.clipboardData?.files.length) {
        e.preventDefault();
        void liveUpload.current(Array.from(e.clipboardData.files));
      }
    }
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    window.addEventListener("dragend", end);
    window.addEventListener("paste", paste);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
      window.removeEventListener("dragend", end);
      window.removeEventListener("paste", paste);
    };
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        (e.target instanceof Element &&
          e.target.closest("input,textarea,select,[contenteditable=true]")) ||
        settings ||
        deleteTask
      )
        return;
      if (
        e.key.toLowerCase() === "n" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey
      ) {
        e.preventDefault();
        setSelectedId(null);
        setMobileHome(false);
        requestAnimationFrame(() => composer.current?.focus());
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
        setTimeout(() => searchRef.current?.focus(), 0);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [settings, deleteTask]);
  function toggle(task: Task) {
    if (task.id.startsWith("pending-")) return;
    const done = !task.done;
    if (done && selection.kind !== "completed") {
      setCompleting((s) => new Set(s).add(task.id));
      completionTimers.set(
        task.id,
        setTimeout(() => {
          setCompleting((s) => {
            const next = new Set(s);
            next.delete(task.id);
            return next;
          });
          void store.revalidate();
        }, 1050),
      );
    }
    if (!done) {
      clearTimeout(completionTimers.get(task.id));
      setCompleting((s) => {
        const next = new Set(s);
        next.delete(task.id);
        return next;
      });
    }
    void store
      .patch(task, { done })
      .then(() => {
        toast({
          message: done ? "One less thing. Nicely done." : "Task reopened.",
          action: {
            label: "Undo",
            run: () => {
              clearTimeout(completionTimers.get(task.id));
              setCompleting((s) => {
                const next = new Set(s);
                next.delete(task.id);
                return next;
              });
              void store
                .patch({ ...task, done }, { done: !done })
                .then(() => store.revalidate())
                .catch(() => {});
            },
          },
        });
      })
      .catch(() => {
        setCompleting((s) => {
          const next = new Set(s);
          next.delete(task.id);
          return next;
        });
      });
  }
  const visible = (store.tasks.data?.tasks || []).filter((t) => {
    if (selection.kind === "completed") return t.done;
    if (t.done && !completing.has(t.id)) return false;
    if (selection.kind === "mine")
      return (
        t.list === "now" &&
        t.assignees.some((a) => a.id === user.id) &&
        (segment === 0 ||
          t.createdBy.id === (segment === 1 ? user.id : teammate.id))
      );
    if (selection.kind === "teammate")
      return t.list === "now" && t.assignees.some((a) => a.id === teammate.id);
    if (selection.kind === "later") return t.list === "later";
    if (selection.kind === "unassigned")
      return t.list === "now" && t.assignees.length === 0;
    if (selection.kind === "project") return t.projectId === selection.id;
    if (selection.kind === "tag")
      return t.tags.some((tag) => tag.id === selection.id);
    return true;
  });
  if (sort === "priority")
    visible.sort((a, b) => b.priority - a.priority || b.position - a.position);
  if (sort === "due")
    visible.sort(
      (a, b) =>
        (a.dueDate || "9999").localeCompare(b.dueDate || "9999") ||
        b.position - a.position,
    );
  const groups: { title: string; tasks: Task[] }[] =
    selection.kind === "project"
      ? [
          { title: "Now", tasks: visible.filter((t) => t.list === "now") },
          { title: "Later", tasks: visible.filter((t) => t.list === "later") },
        ]
      : selection.kind === "mine" && !search && sort === "manual"
        ? [
            {
              title: "Today & overdue",
              tasks: visible.filter((t) => !!t.dueDate && t.dueDate <= day),
            },
            {
              title: "Upcoming",
              tasks: visible.filter((t) => !!t.dueDate && t.dueDate > day),
            },
            { title: "No date", tasks: visible.filter((t) => !t.dueDate) },
          ]
        : [
            {
              title:
                selection.kind === "completed"
                  ? "A little more done"
                  : search
                    ? "Search results"
                    : "On the list",
              tasks: visible,
            },
          ];
  const navProps = {
    user,
    teammate,
    selection,
    onSelect: select,
    projects,
    tags,
    counts: store.counts.data,
    onSettings: () => setSettings(true),
    refresh: store.refreshMeta,
    onSearch: (query: string) => {
      select({ kind: "all" });
      setSearchOpen(true);
      setQuery(query);
      setSearch(query);
    },
  };
  return (
    <div
      className={`app-shell ${mobileHome ? "show-home" : ""} ${selectedId ? "has-detail" : ""}`}
      style={{ "--view-accent": `var(--${accent})` } as React.CSSProperties}
    >
      <Navigation {...navProps} />
      <div className="mobile-home-wrap">
        <Navigation {...navProps} home />
      </div>
      <main className="main-panel">
        <header className="app-toolbar">
          <div className="toolbar-location">
            {user.displayName} & {teammate.displayName}
          </div>
          <button
            className="mobile-back text-button"
            onClick={() => {
              setMobileHome(true);
              setSelectedId(null);
            }}
          >
            <ArrowLeft size={20} /> Lists
          </button>
          <div className="toolbar-actions">
            <button
              className={`icon-button ${searchOpen ? "is-active" : ""}`}
              aria-label="Search tasks"
              onClick={() => {
                setSearchOpen(!searchOpen);
                if (searchOpen) setQuery("");
                else setTimeout(() => searchRef.current?.focus(), 0);
              }}
            >
              <Search size={18} />
            </button>
            <button
              className="icon-button mobile-settings"
              aria-label="Settings"
              onClick={() => setSettings(true)}
            >
              <Settings2 size={19} />
            </button>
            <div className="toolbar-people">
              <Avatar user={user} small />
              <Avatar user={teammate} small />
            </div>
          </div>
        </header>
        <div className="main-content">
          <div className="list-heading">
            <div className="heading-symbol">
              {selection.kind === "project" && project?.emoji ? (
                <span>{project.emoji}</span>
              ) : (
                <Icon size={30} strokeWidth={1.8} />
              )}
            </div>
            <div className="list-heading-top">
              <h1>{title}</h1>
              <div className="list-controls">
                <span className="list-total">{visible.length}</span>
                <div className="sort-wrap">
                  <button
                    className="icon-button"
                    aria-label="Sort tasks"
                    aria-expanded={sortOpen}
                    onClick={() => setSortOpen(!sortOpen)}
                  >
                    <ArrowDownUp size={18} />
                  </button>
                  {sortOpen && (
                    <div className="sort-menu">
                      {(["manual", "priority", "due"] as const).map((s) => (
                        <button
                          key={s}
                          onClick={() => {
                            setSort(s);
                            setSortOpen(false);
                          }}
                        >
                          {s === "manual"
                            ? "Newest first"
                            : s === "priority"
                              ? "Priority"
                              : "Due date"}
                          {sort === s && <Check size={14} />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
            <p>{subtitle}</p>
          </div>
          {searchOpen && (
            <div className="search-field">
              <Search size={17} />
              <input
                ref={searchRef}
                aria-label="Search title and notes"
                placeholder="Search this list…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button
                className="icon-button"
                aria-label="Clear and close search"
                onClick={() => {
                  setSearchOpen(false);
                  setQuery("");
                }}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {selection.kind === "mine" && (
            <div className="segmented-control" aria-label="Filter my tasks">
              {["All", "Made by me", `From ${teammate.displayName}`].map(
                (s, i) => (
                  <button
                    key={s}
                    onClick={() => setSegment(i)}
                    aria-pressed={segment === i}
                    className={segment === i ? "selected" : ""}
                  >
                    {s}
                  </button>
                ),
              )}
            </div>
          )}
          <div className="task-list">
            {store.tasks.isLoading ? (
              <Skeleton />
            ) : store.tasks.error ? (
              <div className="empty-state">
                <span className="empty-illustration">
                  <ArrowUpRight size={38} />
                </span>
                <h2>A little connection trouble.</h2>
                <p>Your list will be here when you reconnect.</p>
                <button
                  className="secondary-button"
                  onClick={() => store.tasks.mutate()}
                >
                  Try again
                </button>
              </div>
            ) : visible.length ? (
              groups
                .filter((g) => g.tasks.length > 0)
                .map((group) => (
                  <section className="task-group" key={group.title}>
                    <div className="task-group-heading">
                      <h2>{group.title}</h2>
                      <span>{group.tasks.length}</span>
                    </div>
                    {group.tasks.map((task) => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        selected={selectedId === task.id}
                        completing={completing.has(task.id)}
                        onOpen={() => {
                          if (!task.id.startsWith("pending-"))
                            setSelectedId(task.id);
                        }}
                        onToggle={() => toggle(task)}
                        onEdit={(input) => store.patch(task, input)}
                        onDelete={() => setDeleteTask(task)}
                        handoffLabel={
                          task.assignees.some((a) => a.id === user.id)
                            ? `Pass to ${teammate.displayName}`
                            : "Take"
                        }
                        onHandoff={() => {
                          const to = task.assignees.some(
                            (a) => a.id === user.id,
                          )
                            ? teammate.id
                            : user.id;
                          void store
                            .patch(task, { assignees: [to] }, true)
                            .catch(() => {});
                        }}
                      />
                    ))}
                  </section>
                ))
            ) : (
              <div className="empty-state">
                <div className={`empty-illustration empty-${selection.kind}`}>
                  <CheckCheck size={42} strokeWidth={1.4} />
                  <Sparkles className="empty-sparkle" size={19} />
                </div>
                <h2>
                  {search
                    ? "Nothing here by that name."
                    : selection.kind === "completed"
                      ? "Good things take little steps."
                      : "A little breathing room."}
                </h2>
                <p>
                  {search
                    ? "Try another word, or clear your search."
                    : selection.kind === "later"
                      ? "Save the ideas you’d love to come back to."
                      : selection.kind === "completed"
                        ? "Your completed tasks will find a home here."
                        : "Nothing on this list. Add a thought below,\nand take it one thing at a time."}
                </p>
                {search && (
                  <button className="text-button" onClick={() => setQuery("")}>
                    Clear search
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="list-endnote">
            {visible.length > 0 && (
              <>
                <Sun size={15} /> One thing at a time is plenty.
              </>
            )}
          </div>
          <Composer
            ref={composer}
            users={[user, teammate]}
            onCreate={create}
            onImages={(files) => upload(files)}
            uploading={uploading}
          />
          <div className="desktop-shortcuts">
            <span>
              <kbd>N</kbd> new task
            </span>
            <span>
              <kbd>↑</kbd>
              <kbd>↓</kbd> navigate
            </span>
            <span>
              <kbd>↵</kbd> open
            </span>
            <span>
              <kbd>space</kbd> complete
            </span>
          </div>
        </div>
      </main>
      {selectedId && selected.data?.task && (
        <TaskDetail
          key={selectedId}
          task={selected.data.task}
          users={[user, teammate]}
          projects={projects}
          tags={tags}
          onClose={() => setSelectedId(null)}
          onPatch={(input, handoff) =>
            store.patch(selected.data!.task, input, handoff)
          }
          onToggle={() => toggle(selected.data!.task)}
          onDelete={() => setDeleteTask(selected.data!.task)}
          onImages={(files) => upload(files, selectedId)}
          onDeleteImage={async (id) => {
            await store.apply(selectedId, (t) => ({
              ...t,
              attachments: t.attachments.filter((a) => a.id !== id),
            }));
            try {
              await api.deleteAttachment(id);
            } catch (err) {
              await store.revalidate();
              throw err;
            }
          }}
          uploading={uploading}
        />
      )}
      {selectedId &&
        selected.error &&
        !(
          selected.error instanceof ApiError && selected.error.status === 404
        ) && (
          <div className="detail-load-error">
            <p>Couldn’t open this task.</p>
            <button onClick={() => setSelectedId(null)} className="text-button">
              Close
            </button>
          </div>
        )}
      {settings && <Settings user={user} onClose={() => setSettings(false)} />}
      {deleteTask && (
        <Confirm
          title="Delete this task?"
          text={`“${deleteTask.title || "New task"}” and its images will be removed for both of you.`}
          onClose={() => setDeleteTask(null)}
          onConfirm={() => {
            if (selectedId === deleteTask.id) setSelectedId(null);
            void store.remove(deleteTask);
          }}
        />
      )}
      {dragging && (
        <div
          className={`drop-overlay ${overDetail && selectedId ? "drop-to-detail" : ""}`}
        >
          <div className="drop-card">
            <span className="drop-icon">
              <ImagePlus size={46} strokeWidth={1.4} />
            </span>
            <h2>
              {overDetail && selectedId
                ? "Drop to add to this task"
                : "Drop to create a task"}
            </h2>
            <p>A picture is a perfectly good place to start.</p>
            <span>All your images. One little task.</span>
          </div>
        </div>
      )}
    </div>
  );
}

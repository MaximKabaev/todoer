"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import {
  notFound,
  usePathname,
  useRouter,
  useSearchParams,
} from "next/navigation";
import Link from "next/link";
import { useAppNavigation } from "@/hooks/use-app-navigation";
import {
  normalizeAppUrl,
  parseListUrl,
  selectionUrl,
  taskBackground,
} from "@/lib/routes";
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
  type CurrentUser,
  type Task,
  type TaskInput,
  type User,
} from "@/lib/api";
import { useActiveProject } from "@/hooks/use-active-project";
import { imageFiles } from "@/lib/utils";
import {
  useWorkspace,
  viewContext,
  type Selection,
} from "@/hooks/use-workspace";
import { Navigation, ProjectSelector, listDefinitions } from "./navigation";
import { ScoreCard } from "./score-card";
import { Composer } from "./composer";
import { TaskRow } from "./task-row";
import { TaskDetail } from "./task-detail";
import { Settings } from "./settings";
import { Avatar, Brand, Confirm, Skeleton } from "./ui";
import { useLocalDay } from "@/hooks/use-local-day";
import { useToast } from "./providers";
export function TodoApp() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams().toString();
  const { data, error } = useSWR<{ user: CurrentUser; teammate: User }>(
    "/api/me",
  );
  useEffect(() => {
    if (error instanceof ApiError && error.status === 401)
      router.replace(
        `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`,
      );
  }, [error, router, pathname, params]);
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
function Workspace({ user, teammate }: { user: CurrentUser; teammate: User }) {
  const day = useLocalDay();
  const setActiveProject = useActiveProject();
  const projectRedirect = useRef<string | null>(null);
  const nav = useAppNavigation();
  const { mutate } = useSWRConfig();
  const [captureToOpen, setCaptureToOpen] = useState<{
    task: Task;
    background: string;
    from: string;
  } | null>(null);
  useEffect(() => {
    if (!captureToOpen) return;
    // Wait until the committed route and its browser history entry are in sync.
    const frame = requestAnimationFrame(() => {
      if (nav.url === normalizeAppUrl(captureToOpen.background)) {
        setCaptureToOpen(null);
        void mutate(
          `/api/tasks/${captureToOpen.task.id}`,
          { task: captureToOpen.task },
          { revalidate: false },
        );
        nav.navigate(`/tasks/${captureToOpen.task.id}`, {
          background: captureToOpen.background,
        });
      } else if (nav.url !== captureToOpen.from) {
        setCaptureToOpen(null);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [captureToOpen, nav, mutate]);
  const settings = nav.pathname === "/settings";
  const selectedId = nav.pathname.startsWith("/tasks/")
    ? decodeURIComponent(nav.pathname.slice(7))
    : null;
  const [missingId, setMissingId] = useState<string | null>(null);
  const selected = useSWR<{ task: Task }>(
    selectedId && missingId !== selectedId ? `/api/tasks/${selectedId}` : null,
    request,
    {
      shouldRetryOnError: (error) =>
        !(error instanceof ApiError && [400, 404].includes(error.status)),
      onError: (error) => {
        if (error instanceof ApiError && [400, 404].includes(error.status))
          setMissingId(selectedId);
      },
    },
  );
  const background =
    nav.background ||
    (selectedId ? taskBackground(selected.data?.task, user) : "/my");
  const rawListUrl = selectedId || settings ? background : nav.url;
  const listUrl =
    rawListUrl === `/people/${encodeURIComponent(user.username)}`
      ? "/my"
      : rawListUrl;
  const { selection, segment, search } = parseListUrl(listUrl);
  const mobileHome = listUrl === "/";
  const setSegment = (value: number) =>
    nav.navigate(selectionUrl({ kind: "mine" }, teammate, value));
  const closeOverlay = useCallback(
    () => nav.back(background, true),
    [nav, background],
  );
  const setSelectedId = useCallback(
    (id: string | null) => {
      if (id && !id.startsWith("pending-"))
        nav.navigate(`/tasks/${id}`, { background: listUrl });
      else if (!id && selectedId) closeOverlay();
    },
    [nav, listUrl, selectedId, closeOverlay],
  );
  const openTask = (task: Task, background = listUrl) => {
    if (task.id.startsWith("pending-")) return;
    // The list/create response already contains the full task. Open immediately,
    // then let the inspector's normal SWR revalidation check for newer edits.
    void mutate(`/api/tasks/${task.id}`, { task }, { revalidate: false });
    nav.navigate(`/tasks/${task.id}`, { background });
  };
  const setSettings = (open: boolean) =>
    open ? nav.navigate("/settings", { background: listUrl }) : closeOverlay();
  const [deleteTask, setDeleteTask] = useState<Task | null>(null);
  const [queryDraft, setQueryDraft] = useState<{
    url: string;
    value: string;
  } | null>(null);
  const query = queryDraft?.url === nav.url ? queryDraft.value : search;
  const setQuery = (value: string) => setQueryDraft({ url: nav.url, value });
  const [searchOpen, setSearchOpen] = useState(false);
  const [sort, setSort] = useState<"manual" | "priority" | "due">("manual");
  const [sortOpen, setSortOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [overDetail, setOverDetail] = useState(false);
  const dragDepth = useRef(0);
  const [uploading, setUploading] = useState(false);
  const [completionPending] = useState(() => new Set<string>());
  const [completing, setCompleting] = useState<Set<string>>(new Set());
  const [completionTimers] = useState(
    () => new Map<string, ReturnType<typeof setTimeout>>(),
  );
  const composer = useRef<HTMLInputElement>(null);
  const focusCapture = useRef(false);
  useEffect(() => {
    if (!mobileHome && !selectedId && focusCapture.current) {
      focusCapture.current = false;
      composer.current?.focus();
    }
  }, [mobileHome, selectedId]);
  const searchRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const onMissing = useCallback((id: string) => {
    setMissingId(id);
    setDeleteTask((current) => (current?.id === id ? null : current));
  }, []);
  const store = useWorkspace(
    selection,
    segment,
    search,
    user,
    teammate,
    onMissing,
  );
  const projects = store.projects.data?.projects || [];
  const tags = store.tags.data?.tags || [];
  const lists = listDefinitions(teammate, store.counts.data);
  const currentList = lists.find((l) => l.kind === selection.kind);
  const tag = tags.find((t) => t.name === selection.id);
  const title =
    (selection.kind === "all" ? `Search: ${search}` : "") ||
    currentList?.title ||
    (tag
      ? `#${tag.name}`
      : selection.kind === "tag"
        ? `#${selection.id}`
        : "") ||
    "Tasks";
  const accent = currentList?.color || "teal";
  const Icon = currentList?.icon || ListTodo;
  const context = viewContext(selection, user, teammate);
  const activeProject = projects.find((p) => p.id === user.activeProjectId);
  useEffect(() => {
    if (!nav.pathname.startsWith("/projects/")) {
      projectRedirect.current = null;
      return;
    }
    if (projectRedirect.current === nav.pathname) return;
    projectRedirect.current = nav.pathname;
    const id = decodeURIComponent(nav.pathname.slice(10));
    void setActiveProject(id)
      .catch(() => {})
      .finally(() => nav.navigate("/my", { replace: true }));
  }, [nav, setActiveProject]);
  async function createCapture(input: TaskInput, files: File[] = []) {
    if (selection.kind === "later" || input.list === "later")
      input = { ...input, list: "later", assignees: [], addAssignees: [] };
    // /api/me is already cached: the optimistic row never waits for a lookup.
    const projectId = user.activeProjectId;
    try {
      return await store.create({ ...context, ...input, projectId }, files, {
        quiet: !!projectId,
      });
    } catch (error) {
      if (!projectId || !(error instanceof ApiError && error.status === 400)) {
        if (projectId)
          toast({
            message:
              error instanceof Error ? error.message : "Could not create task.",
            error: true,
          });
        throw error;
      }
      const [freshMe, freshProjects] = await Promise.all([
        api.me(),
        api.projects(),
      ]);
      await mutate("/api/me", freshMe, { revalidate: false });
      await store.projects.mutate(freshProjects, { revalidate: false });
      if (freshProjects.projects.some((p) => p.id === projectId)) {
        toast({ message: error.message, error: true });
        throw error;
      }
      return store.create({ ...context, ...input, projectId: null }, files);
    }
  }
  const subtitle =
    selection.kind === "mine"
      ? "A clear mind starts with a little list."
      : selection.kind === "teammate"
        ? "A little teamwork goes a long way."
        : selection.kind === "later"
          ? "Future changes / things to look at"
          : selection.kind === "completed"
            ? "Small steps. Real progress. Nicely done."
            : selection.kind === "tag"
              ? "Everything with a common thread."
              : "Good ideas, waiting for a person.";
  useEffect(() => {
    if (
      !queryDraft ||
      queryDraft.url !== nav.url ||
      queryDraft.value === search
    )
      return;
    const timer = setTimeout(
      () =>
        nav.navigate(`/search?q=${encodeURIComponent(queryDraft.value)}`, {
          replace: nav.pathname === "/search",
        }),
      250,
    );
    return () => clearTimeout(timer);
  }, [queryDraft, search, nav]);
  const pageTitle = settings
    ? "Settings"
    : selectedId
      ? missingId === selectedId
        ? "Task not found"
        : selected.data?.task?.title || "Untitled task"
      : selection.kind === "teammate"
        ? `${teammate.displayName}'s Tasks`
        : title;
  useEffect(() => {
    if (nav.pathname === `/people/${encodeURIComponent(user.username)}`)
      nav.navigate("/my", { replace: true });
  }, [nav, user.username]);
  useEffect(() => {
    const timers = completionTimers;
    return () => {
      timers.forEach(clearTimeout);
    };
  }, [completionTimers]);
  const select = (value: Selection) => {
    setQueryDraft(null);
    nav.navigate(selectionUrl(value, teammate));
  };
  const create = async (input: TaskInput, open = false) => {
    let captureListUrl = listUrl;
    if (selection.kind === "mine" && segment === 2) captureListUrl = "/my";
    if (search || query) {
      setQueryDraft(null);
      captureListUrl = selectionUrl(
        selection,
        teammate,
        segment === 2 ? 0 : segment,
      );
    }
    if (captureListUrl !== listUrl && !selectedId) nav.navigate(captureListUrl);
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
    const task = await createCapture(value);
    if (open) {
      // Let an automatic filter reset commit before pushing the inspector, so
      // browser Back returns to the same list that is visible behind the task.
      if (captureListUrl !== listUrl && !selectedId)
        setCaptureToOpen({ task, background: captureListUrl, from: listUrl });
      else openTask(task);
    }
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
        void store.refreshMeta();
      } else {
        const task = await createCapture({}, valid);
        openTask(task);
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
        if (selectedId || mobileHome) focusCapture.current = true;
        setSelectedId(null);
        if (mobileHome) nav.navigate("/my");
        else if (!selectedId) composer.current?.focus();
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
        setTimeout(() => searchRef.current?.focus(), 0);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [settings, deleteTask, setSelectedId, selectedId, mobileHome, nav]);
  function handleToggle(task: Task) {
    if (task.id.startsWith("pending-") || completionPending.has(task.id)) return;
    completionPending.add(task.id);
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
        }, 2500),
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
      .then((result) => {
        toast({
          message: done ? "Who’s a good boy?" : "Task reopened.",
          scoreChange: done ? result.scoreChange : undefined,
          celebration: done,
          action: {
            label: "Undo",
            run: () => {
              if (completionPending.has(task.id)) return;
              completionPending.add(task.id);
              clearTimeout(completionTimers.get(task.id));
              setCompleting((s) => {
                const next = new Set(s);
                next.delete(task.id);
                return next;
              });
              void store
                .patch({ ...task, done }, { done: !done })
                .then(() => {
                  return store.revalidate();
                })
                .catch(() => {})
                .finally(() => completionPending.delete(task.id));
            },
          },
        });
      })
      .catch(() => {
        clearTimeout(completionTimers.get(task.id));
        setCompleting((s) => {
          const next = new Set(s);
          next.delete(task.id);
          return next;
        });
      })
      .finally(() => completionPending.delete(task.id));
  }
  const visible = (store.tasks.data?.tasks || []).filter((t) => {
    if (user.activeProjectId && t.projectId !== user.activeProjectId)
      return false;
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
    if (selection.kind === "tag")
      return t.tags.some(
        (tag) => tag.name.toLowerCase() === selection.id?.toLowerCase(),
      );
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
    selection.kind === "mine" && !search && sort === "manual"
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
    refresh: async () => {
      await mutate("/api/me");
      await store.revalidate();
    },
    activeProjectId: user.activeProjectId,
    onProjectSelect: setActiveProject,
    onSearch: (query: string) => {
      setSearchOpen(true);
      nav.navigate(`/search?q=${encodeURIComponent(query)}`);
    },
  };
  if (
    nav.pathname.startsWith("/people/") &&
    ![user.username, teammate.username].includes(
      decodeURIComponent(nav.pathname.slice(8)),
    )
  )
    notFound();
  return (
    <div
      className={`app-shell ${mobileHome ? "show-home" : ""} ${selectedId ? "has-detail" : ""}`}
      style={{ "--view-accent": `var(--${accent})` } as React.CSSProperties}
    >
      <title>{`${pageTitle} · todoer`}</title>
      <Navigation {...navProps} />
      <div className="mobile-home-wrap">
        <Navigation {...navProps} home />
      </div>
      <main className="main-panel">
        <header className="app-toolbar">
          <div className="toolbar-location">
            {activeProject?.name || "All projects"}
          </div>
          <button
            className="mobile-back text-button"
            onClick={() => nav.back("/")}
          >
            <ArrowLeft size={20} /> Lists
          </button>
          <div className="mobile-project-control">
            <ProjectSelector
              projects={projects}
              activeProjectId={user.activeProjectId}
              onSelect={setActiveProject}
              refresh={navProps.refresh}
              compact
            />
          </div>
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
              <Icon size={30} strokeWidth={1.8} />
            </div>
            <div className="list-heading-top">
              <div className="list-title-group">
                <h1>{title}</h1>
                <span className="list-total" aria-label={`${visible.length} tasks`}>{visible.length}</span>
              </div>
              <div className="list-controls">
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
          {(selection.kind === "mine" || selection.kind === "teammate") && (
            <ScoreCard
              score={store.score.error ? undefined : store.score.data}
              viewed={selection.kind === "mine" ? "me" : "teammate"}
            />
          )}
          {(searchOpen || selection.kind === "all") && (
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
                  setQueryDraft(null);
                  if (selection.kind === "all") nav.back("/my", true);
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
            {store.tasks.isLoading && !store.tasks.data ? (
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
                          if (!task.id.startsWith("pending-")) openTask(task);
                        }}
                        onToggle={() => handleToggle(task)}
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
            later={selection.kind === "later"}
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
      {selectedId && missingId !== selectedId && selected.data?.task && (
        <TaskDetail
          key={selectedId}
          task={selected.data.task}
          users={[user, teammate]}
          projects={projects}
          tags={tags}
          onClose={() => setSelectedId(null)}
          activeProjectId={user.activeProjectId}
          onSwitchProject={setActiveProject}
          onPatch={async (input, handoff) => {
            const { task } = await store.patch(selected.data!.task, input, handoff);
            if (
              input.projectId !== undefined &&
              user.activeProjectId &&
              task.projectId !== user.activeProjectId
            ) {
              setSelectedId(null);
              toast({
                message: `Moved to ${task.project?.name || "No project"}`,
              });
            }
            return task;
          }}
          onToggle={() => handleToggle(selected.data!.task)}
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
      {selectedId && missingId === selectedId && (
        <div className="missing-task" role="status">
          <h1>This task doesn’t exist (or was deleted)</h1>
          <p>It may have been removed from your shared space.</p>
          <Link
            href="/my"
            onNavigate={(e) => {
              e.preventDefault();
              nav.navigate("/my");
            }}
            className="primary-button"
          >
            Back to My Tasks
          </Link>
        </div>
      )}
      {settings && (
        <Settings
          user={user}
          teammate={teammate}
          onClose={() => setSettings(false)}
        />
      )}
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

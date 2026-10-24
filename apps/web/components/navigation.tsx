"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { selectionUrl } from "@/lib/routes";
import {
  Archive,
  CheckCheck,
  ChevronRight,
  ChevronsUpDown,
  Check,
  Layers,
  Hash,
  Inbox,
  ListTodo,
  Plus,
  Settings2,
  Search,
  Sparkles,
  Users,
} from "lucide-react";
import {
  api,
  type Color,
  type Counts,
  type Project,
  type Tag,
  type User,
} from "@/lib/api";
import { colors } from "@/lib/utils";
import type { Selection } from "@/hooks/use-workspace";
import { Avatar, Brand, Confirm, Modal } from "./ui";
import { useToast } from "./providers";
export function listDefinitions(teammate: User, counts?: Counts) {
  return [
    {
      kind: "mine" as const,
      title: "My Tasks",
      icon: ListTodo,
      color: "blue",
      count: counts?.mine || 0,
      description: "A little focus for today",
    },
    {
      kind: "teammate" as const,
      title: `${teammate.displayName}’s Tasks`,
      icon: Users,
      color: "orange",
      count: counts?.teammate || 0,
      description: "Better, together",
    },
    {
      kind: "later" as const,
      title: "Later",
      icon: Archive,
      color: "purple",
      count: counts?.later || 0,
      description: "Good things can wait",
    },
    {
      kind: "completed" as const,
      title: "Completed",
      icon: CheckCheck,
      color: "green",
      count: counts?.completed || 0,
      description: "Look how far you’ve come",
    },
    {
      kind: "unassigned" as const,
      title: "Unassigned",
      icon: Inbox,
      color: "gray",
      count: counts?.unassigned || 0,
      description: "A place to start",
    },
  ];
}
type Props = {
  user: User;
  teammate: User;
  selection: Selection;
  onSelect: (selection: Selection) => void;
  projects: Project[];
  tags: Tag[];
  counts?: Counts;
  onSettings: () => void;
  refresh: () => Promise<unknown>;
  activeProjectId: string | null;
  onProjectSelect: (id: string | null) => Promise<unknown>;
  home?: boolean;
  onSearch: (query: string) => void;
};
export function Navigation({
  user,
  teammate,
  selection,
  onSelect,
  projects,
  tags,
  counts,
  onSettings,
  refresh,
  home = false,
  onSearch,
  activeProjectId,
  onProjectSelect,
}: Props) {
  const lists = listDefinitions(teammate, counts);
  return (
    <aside className={home ? "mobile-home" : "sidebar"}>
      {home ? (
        <>
          <div className="home-top">
            <Brand />
            <Link
              href="/settings"
              className="icon-button"
              aria-label="Settings"
              onNavigate={(e) => {
                e.preventDefault();
                onSettings();
              }}
            >
              <Avatar user={user} />
            </Link>
          </div>
          <h1 className="home-greeting">Your lists</h1>
          <form
            className="home-search search-field"
            onSubmit={(e) => {
              e.preventDefault();
              const query = String(
                new FormData(e.currentTarget).get("q") || "",
              ).trim();
              if (query) onSearch(query);
            }}
          >
            <Search size={18} />
            <input
              name="q"
              aria-label="Search all tasks"
              placeholder="Search all tasks"
              type="search"
            />
            <button className="text-button" type="submit">
              Search
            </button>
          </form>
        </>
      ) : (
        <>
          <Brand />
          <div className="workspace-label">
            <span className="status-dot" /> A space for two{" "}
            <span className="workspace-avatars">
              <Avatar user={user} small />
              <Avatar user={teammate} small />
            </span>
          </div>
        </>
      )}
      <ProjectSelector
        projects={projects}
        activeProjectId={activeProjectId}
        onSelect={onProjectSelect}
        refresh={refresh}
      />
      <nav
        aria-label="Task lists"
        className={home ? "home-cards" : "smart-lists"}
      >
        {lists.map(({ kind, title, icon: Icon, color, count }) => (
          <Link
            key={kind}
            href={selectionUrl({ kind }, teammate)}
            onNavigate={(e) => {
              e.preventDefault();
              onSelect({ kind });
            }}
            className={`${home ? "list-card" : "nav-item"} ${selection.kind === kind && !home ? "active" : ""} ${kind === "unassigned" ? "unassigned-card" : ""}`}
            style={{ "--accent": `var(--${color})` } as React.CSSProperties}
          >
            <span className="list-icon">
              <Icon size={home ? 22 : 18} strokeWidth={1.9} />
            </span>
            <span className="nav-title">{title}</span>
            <span className="nav-count">{count}</span>
            {home && kind === "unassigned" && <ChevronRight size={17} />}
          </Link>
        ))}
      </nav>
      <div className="nav-section tags-section">
        <div className="section-label">
          <span>Tags</span>
          <Hash size={13} />
        </div>
        <div className="nav-tags">
          {tags.map((tag) => (
            <Link
              href={selectionUrl({ kind: "tag", id: tag.name }, teammate)}
              key={tag.id}
              className={`tag-filter ${selection.kind === "tag" && selection.id === tag.name ? "selected" : ""}`}
              onNavigate={(e) => {
                e.preventDefault();
                onSelect({ kind: "tag", id: tag.name });
              }}
            >
              <Hash size={12} />
              <span>{tag.name}</span>
              <span className="tag-count">{tag.count || 0}</span>
            </Link>
          ))}
          {!tags.length && (
            <span className="muted small">
              Add #tags when you capture a task.
            </span>
          )}
        </div>
      </div>
      {!home && (
        <div className="sidebar-bottom">
          <div className="together-note">
            <Sparkles size={16} />
            <span>Big things start small.</span>
          </div>
          <Link
            href="/settings"
            className="account-button"
            onNavigate={(e) => {
              e.preventDefault();
              onSettings();
            }}
          >
            <Avatar user={user} />
            <span>
              <strong>{user.displayName}</strong>
              <small>Settings & account</small>
            </span>
            <Settings2 size={17} />
          </Link>
        </div>
      )}
      {home && (
        <div className="home-footer">
          <span className="status-dot" /> Shared with {teammate.displayName}
          <span>Made for the two of you.</span>
        </div>
      )}
    </aside>
  );
}
function ProjectEditor({
  project,
  onClose,
  onSave,
  onDelete,
}: {
  project?: Project;
  onClose: () => void;
  onSave: () => Promise<void>;
  onDelete?: () => void;
}) {
  const [name, setName] = useState(project?.name || "");
  const [color, setColor] = useState<Color>(project?.color || "blue");
  const [emoji, setEmoji] = useState(project?.emoji || "");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <Modal title={project ? "Edit project" : "A new project"} onClose={onClose}>
      <form
        className="project-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            if (project)
              await api.updateProject(project.id, {
                name: name.trim() || "New Project",
                color,
                emoji: emoji || null,
              });
            else
              await api.createProject({
                name: name.trim() || "New Project",
                color,
                emoji: emoji || null,
              });
            await onSave();
          } catch (err) {
            toast({
              message:
                err instanceof Error ? err.message : "Could not save project.",
              error: true,
            });
            setBusy(false);
          }
        }}
      >
        <p className="muted">Give your next little adventure a home.</p>
        <div className="project-name-fields">
          <label>
            Emoji
            <input
              value={emoji}
              onChange={(e) => setEmoji(e.target.value)}
              placeholder="✨"
              maxLength={16}
            />
          </label>
          <label>
            Project name
            <input
              data-autofocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="New Project"
            />
          </label>
        </div>
        <label>Color</label>
        <div className="color-picker">
          {colors.map((c) => (
            <button
              type="button"
              key={c}
              aria-label={c}
              aria-pressed={c === color}
              className={c === color ? "selected" : ""}
              style={{ background: `var(--${c})` }}
              onClick={() => setColor(c)}
            >
              {c === color && <CheckCheck size={18} />}
            </button>
          ))}
        </div>
        <div className="project-form-actions">
          {onDelete && (
            <button type="button" className="text-danger" onClick={onDelete}>
              Delete project
            </button>
          )}
          <button className="primary-button" disabled={busy}>
            {busy ? "Saving…" : project ? "Save project" : "Create project"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function InlineProject({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (project: Project) => Promise<unknown>;
}) {
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("");
  const [color, setColor] = useState<Color>("blue");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <form
      className="inline-project-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          const { project } = await api.createProject({
            name: name.trim() || "New Project",
            emoji: emoji || null,
            color,
          });
          await onSave(project);
          onClose();
        } catch (err) {
          toast({
            message:
              err instanceof Error ? err.message : "Could not add project.",
            error: true,
          });
          setBusy(false);
        }
      }}
    >
      <div className="inline-project-name">
        <input
          aria-label="Project emoji"
          value={emoji}
          placeholder="☀"
          onChange={(e) => setEmoji(e.target.value)}
          maxLength={16}
        />
        <input
          autoFocus
          aria-label="New project name"
          placeholder="New Project"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
          }}
        />
      </div>
      <div className="color-picker">
        {colors.map((c) => (
          <button
            type="button"
            key={c}
            aria-label={`Project color ${c}`}
            aria-pressed={c === color}
            style={{ background: `var(--${c})` }}
            className={c === color ? "selected" : ""}
            onClick={() => setColor(c)}
          />
        ))}
      </div>
      <div className="inline-project-actions">
        <button type="button" className="text-button" onClick={onClose}>
          Cancel
        </button>
        <button className="primary-button" disabled={busy}>
          {busy ? "Adding…" : "Add project"}
        </button>
      </div>
    </form>
  );
}

export function ProjectSelector({
  projects,
  activeProjectId,
  onSelect,
  refresh,
  compact = false,
}: {
  projects: Project[];
  activeProjectId: string | null;
  onSelect: (id: string | null) => Promise<unknown>;
  refresh: () => Promise<unknown>;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Project | "new" | null>(null);
  const [deleting, setDeleting] = useState<Project | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState({ top: 0, left: 0 });
  const toast = useToast();
  const project = projects.find((p) => p.id === activeProjectId);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (
        !ref.current?.contains(e.target as Node) &&
        !popup.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setEditing(null);
        trigger.current?.focus();
      }
    };
    popup.current
      ?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')
      ?.focus();
    const reposition = () => setOpen(false);
    window.addEventListener("resize", reposition);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("resize", reposition);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  function pick(id: string | null) {
    setOpen(false);
    setEditing(null);
    trigger.current?.focus();
    void onSelect(id).catch(() => {});
  }
  return (
    <div
      className={`project-selector ${compact ? "compact-project-selector" : ""}`}
      ref={ref}
    >
      <button
        ref={trigger}
        className="project-popup-button"
        aria-label={`Active project: ${project?.name || "All projects"}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => {
          const rect = trigger.current!.getBoundingClientRect();
          setAnchor({
            top: rect.bottom + 6,
            left: Math.max(16, Math.min(rect.left, window.innerWidth - 308)),
          });
          setOpen(!open);
        }}
      >
        {project ? (
          <>
            <span
              className="field-project-dot"
              style={{ background: `var(--${project.color})` }}
            />
            <span>{project.emoji}</span>
          </>
        ) : (
          <Layers size={15} />
        )}
        <span className="project-popup-name">
          {project?.name || "All projects"}
        </span>
        <ChevronsUpDown size={13} />
      </button>
      {open &&
        createPortal(
          <div
            ref={popup}
            className="project-popup"
            style={{
              top: anchor.top,
              left: anchor.left,
              maxHeight: `calc(100dvh - ${anchor.top + 16}px)`,
            }}
            role="dialog"
            aria-label="Choose active project"
            onKeyDown={(e) => {
              if (
                !["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key) ||
                (e.target as HTMLElement).tagName === "INPUT"
              )
                return;
              e.preventDefault();
              const buttons = Array.from(
                popup.current!.querySelectorAll<HTMLButtonElement>("button"),
              );
              const index = buttons.indexOf(
                document.activeElement as HTMLButtonElement,
              );
              const next =
                e.key === "Home"
                  ? 0
                  : e.key === "End"
                    ? buttons.length - 1
                    : (index +
                        (e.key === "ArrowDown" ? 1 : -1) +
                        buttons.length) %
                      buttons.length;
              buttons[next]?.focus();
            }}
          >
            <div className="project-popup-label">PROJECT</div>
            <div className="project-popup-options">
              {projects.map((p) => (
                <div className="project-popup-row" key={p.id}>
                  <button
                    className="project-option"
                    aria-pressed={activeProjectId === p.id}
                    onClick={() => pick(p.id)}
                  >
                    <span
                      className="field-project-dot"
                      style={{ background: `var(--${p.color})` }}
                    />
                    <span>{p.emoji}</span>
                    <span className="project-popup-name">{p.name}</span>
                    <span className="nav-count">{p.openCount || 0}</span>
                    {activeProjectId === p.id && <Check size={14} />}
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`Edit project ${p.name}`}
                    onClick={() => {
                      setEditing(p);
                      setOpen(false);
                    }}
                  >
                    <Settings2 size={14} />
                  </button>
                </div>
              ))}
            </div>
            <button
              className="project-option all-projects-option"
              aria-pressed={!activeProjectId}
              onClick={() => pick(null)}
            >
              <Layers size={16} />
              <span className="project-popup-name">All projects</span>
              {!activeProjectId && <Check size={14} />}
            </button>
            <button
              className="project-option new-project-option"
              onClick={() => setEditing(editing === "new" ? null : "new")}
            >
              <Plus size={16} /> New project…
            </button>
            {editing === "new" && (
              <InlineProject
                onClose={() => setEditing(null)}
                onSave={async (p) => {
                  await refresh();
                  await onSelect(p.id);
                  setOpen(false);
                }}
              />
            )}
          </div>,
          document.body,
        )}
      {editing && editing !== "new" && (
        <ProjectEditor
          project={editing}
          onClose={() => setEditing(null)}
          onSave={async () => {
            await refresh();
            setEditing(null);
          }}
          onDelete={() => {
            setDeleting(editing);
            setEditing(null);
          }}
        />
      )}
      {deleting && (
        <Confirm
          title="Delete this project?"
          text="Its tasks will be kept without a project. The project will be removed for both of you."
          onClose={() => setDeleting(null)}
          onConfirm={() => {
            void api
              .deleteProject(deleting.id)
              .then(refresh)
              .catch((error) => toast({ message: error.message, error: true }));
          }}
        />
      )}
    </div>
  );
}

"use client";
import { useState } from "react";
import {
  Archive,
  CheckCheck,
  ChevronRight,
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
}: Props) {
  const [editing, setEditing] = useState<Project | "new" | null>(null);
  const [deleteProject, setDeleteProject] = useState<Project | null>(null);
  const lists = listDefinitions(teammate, counts);
  const toast = useToast();
  return (
    <aside className={home ? "mobile-home" : "sidebar"}>
      {home ? (
        <>
          <div className="home-top">
            <Brand />
            <button
              className="icon-button"
              aria-label="Settings"
              onClick={onSettings}
            >
              <Avatar user={user} />
            </button>
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
      <nav
        aria-label="Task lists"
        className={home ? "home-cards" : "smart-lists"}
      >
        {lists.map(({ kind, title, icon: Icon, color, count }) => (
          <button
            key={kind}
            onClick={() => onSelect({ kind })}
            className={`${home ? "list-card" : "nav-item"} ${selection.kind === kind && !home ? "active" : ""} ${kind === "unassigned" ? "unassigned-card" : ""}`}
            style={{ "--accent": `var(--${color})` } as React.CSSProperties}
          >
            <span className="list-icon">
              <Icon size={home ? 22 : 18} strokeWidth={1.9} />
            </span>
            <span className="nav-title">{title}</span>
            <span className="nav-count">{count}</span>
            {home && kind === "unassigned" && <ChevronRight size={17} />}
          </button>
        ))}
      </nav>
      <div className="nav-section">
        <div className="section-label">
          <span>Projects</span>
          <button
            className="icon-button"
            aria-label="Add project"
            onClick={() => setEditing("new")}
          >
            <Plus size={16} />
          </button>
        </div>
        {editing === "new" && (
          <InlineProject onClose={() => setEditing(null)} onSave={refresh} />
        )}
        <div className={home ? "home-projects" : ""}>
          {projects.map((p) => (
            <div className="project-nav-wrap" key={p.id}>
              <button
                className={`nav-item project-nav ${selection.kind === "project" && selection.id === p.id ? "active" : ""}`}
                onClick={() => onSelect({ kind: "project", id: p.id })}
                style={
                  { "--accent": `var(--${p.color})` } as React.CSSProperties
                }
              >
                <span className="project-emoji">
                  {p.emoji || <span className="project-dot" />}
                </span>
                <span className="nav-title">{p.name}</span>
                <span className="nav-count">{p.openCount || 0}</span>
                {home && <ChevronRight size={16} />}
              </button>
              <button
                className="project-edit icon-button"
                aria-label={`Edit project ${p.name}`}
                onClick={() => setEditing(p)}
              >
                <Settings2 size={13} />
              </button>
            </div>
          ))}
          {!projects.length && (
            <button className="empty-project" onClick={() => setEditing("new")}>
              <Plus size={16} /> Make a little project
            </button>
          )}
        </div>
      </div>
      <div className="nav-section tags-section">
        <div className="section-label">
          <span>Tags</span>
          <Hash size={13} />
        </div>
        <div className="nav-tags">
          {tags.map((tag) => (
            <button
              key={tag.id}
              className={`tag-filter ${selection.kind === "tag" && selection.id === tag.id ? "selected" : ""}`}
              onClick={() => onSelect({ kind: "tag", id: tag.id })}
            >
              <Hash size={12} />
              <span>{tag.name}</span>
            </button>
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
          <button className="account-button" onClick={onSettings}>
            <Avatar user={user} />
            <span>
              <strong>{user.displayName}</strong>
              <small>Settings & account</small>
            </span>
            <Settings2 size={17} />
          </button>
        </div>
      )}
      {home && (
        <div className="home-footer">
          <span className="status-dot" /> Shared with {teammate.displayName}
          <span>Made for the two of you.</span>
        </div>
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
            setDeleteProject(editing);
            setEditing(null);
          }}
        />
      )}
      {deleteProject && (
        <Confirm
          title="Delete this project?"
          text="Your tasks will stay. Only the project will be removed, for both of you."
          onClose={() => setDeleteProject(null)}
          onConfirm={() => {
            api
              .deleteProject(deleteProject.id)
              .then(async () => {
                await refresh();
                if (
                  selection.kind === "project" &&
                  selection.id === deleteProject.id
                )
                  onSelect({ kind: "mine" });
              })
              .catch((error) => toast({ message: error.message, error: true }));
          }}
        />
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
  onSave: () => Promise<unknown>;
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
          await api.createProject({
            name: name.trim() || "New Project",
            emoji: emoji || null,
            color,
          });
          await onSave();
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

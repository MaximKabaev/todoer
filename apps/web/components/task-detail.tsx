"use client";
import Image from "next/image";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Flag,
  ImagePlus,
  LoaderCircle,
  MoreHorizontal,
  Link as LinkIcon,
  Share2,
  Send,
  Trash2,
  X,
} from "lucide-react";
import {
  ApiError,
  type Project,
  type Tag,
  type Task,
  type TaskInput,
  type User,
} from "@/lib/api";
import { middleFilename, taskAccent, timeAgo } from "@/lib/utils";
import { useDialog } from "@/hooks/use-dialog";
import { useMedia } from "@/hooks/use-media";
import { Avatar, Checkbox, Confirm, Modal } from "./ui";
import { useToast } from "./providers";
import { ZoomableImage } from "./zoomable-image";
const subscribeShare = () => () => {};
const canShare = () => typeof navigator.share === "function";

type Props = {
  task: Task;
  users: [User, User];
  projects: Project[];
  tags: Tag[];
  onClose: () => void;
  onPatch: (input: TaskInput, handoff?: boolean) => Promise<unknown>;
  activeProjectId: string | null;
  onSwitchProject: (id: string | null) => Promise<unknown>;
  onToggle: () => void;
  onDelete: () => void;
  onImages: (files: File[]) => Promise<unknown>;
  onDeleteImage: (id: string) => Promise<unknown>;
  uploading: boolean;
};
export function TaskDetail({
  task,
  users,
  projects,
  tags,
  onClose,
  onPatch,
  activeProjectId,
  onSwitchProject,
  onToggle,
  onDelete,
  onImages,
  onDeleteImage,
  uploading,
}: Props) {
  const mobile = useMedia("(max-width: 760px)");
  const nativeShare = useSyncExternalStore(
    subscribeShare,
    canShare,
    () => false,
  );
  const [draft, setDraft] = useState({ title: task.title, notes: task.notes });
  const [tagInput, setTagInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [deleteImage, setDeleteImage] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const pending = useRef<TaskInput>({});
  const retired = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const patchRef = useRef(onPatch);
  const inFlight = useRef(0);
  const toast = useToast();
  const dragY = useRef(0);
  const [offset, setOffset] = useState(0);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    patchRef.current = onPatch;
  }, [onPatch]);
  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    const fields = pending.current;
    if (!Object.keys(fields).length) return;
    pending.current = {};
    inFlight.current++;
    setSaving(true);
    setSaveError(false);
    void patchRef
      .current(fields)
      .catch((error) => {
        if (error instanceof ApiError && error.status === 404) {
          retired.current = true;
          pending.current = {};
          return;
        }
        setSaveError(true);
        pending.current = { ...fields, ...pending.current };
      })
      .finally(() => {
        inFlight.current--;
        if (!inFlight.current) setSaving(false);
      });
  }, []);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (!retired.current && Object.keys(pending.current).length)
        void patchRef.current(pending.current).catch(() => {});
    },
    [],
  );
  useEffect(() => {
    if (notesRef.current) {
      notesRef.current.style.height = "auto";
      notesRef.current.style.height = `${notesRef.current.scrollHeight}px`;
    }
  }, [draft.notes]);
  // Preserve a local typing session while accepting the other person's edits when idle.
  useEffect(() => {
    setDraft((current) => ({
      title:
        pending.current.title !== undefined || inFlight.current > 0
          ? current.title
          : task.title,
      notes:
        pending.current.notes !== undefined || inFlight.current > 0
          ? current.notes
          : task.notes,
    }));
  }, [task.title, task.notes]);
  const close = () => {
    flush();
    onClose();
  };
  const ref = useDialog(close);
  function edit(field: "title" | "notes", value: string) {
    setDraft((d) => ({ ...d, [field]: value }));
    pending.current[field] = value;
    setSaveError(false);
    setSaving(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 550);
  }
  function patch(input: TaskInput, handoff = false) {
    setSaving(true);
    setSaveError(false);
    inFlight.current++;
    void onPatch(input, handoff)
      .catch((error) => {
        if (error instanceof ApiError && error.status === 404) {
          retired.current = true;
          pending.current = {};
          return;
        }
        pending.current = { ...input, ...pending.current };
        setSaveError(true);
      })
      .finally(() => {
        inFlight.current--;
        if (!inFlight.current) setSaving(false);
      });
  }
  const take = !task.assignees.some((a) => a.id === users[0].id);
  const addTag = (value: string) => {
    const name = value.trim().replace(/^#/, "");
    if (
      name &&
      !task.tags.some((t) => t.name.toLowerCase() === name.toLowerCase())
    )
      patch({ tags: [...task.tags.map((t) => t.id), name] });
    setTagInput("");
  };
  return (
    <>
      <div className="detail-scrim" onClick={close} />
      <div
        ref={ref}
        className="task-detail"
        role="dialog"
        aria-modal={mobile || undefined}
        aria-label="Task details"
        style={{ transform: offset ? `translateY(${offset}px)` : undefined }}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (e.dataTransfer.files.length)
            void onImages(Array.from(e.dataTransfer.files));
        }}
      >
        <div
          className="sheet-handle"
          onPointerDown={(e) => {
            dragY.current = e.clientY;
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId))
              setOffset(Math.max(0, e.clientY - dragY.current));
          }}
          onPointerUp={(e) => {
            if (offset > 100) close();
            setOffset(0);
            e.currentTarget.releasePointerCapture(e.pointerId);
          }}
        >
          <span />
        </div>
        <div className="detail-toolbar">
          <span className="eyebrow">TASK DETAILS</span>
          <span className={`save-state ${saveError ? "save-error" : ""}`}>
            {saveError ? (
              <button onClick={flush}>Retry saving</button>
            ) : saving ? (
              <>
                <LoaderCircle size={12} className="spin" /> Saving
              </>
            ) : (
              <>
                <Check size={12} /> Saved
              </>
            )}
          </span>
          <button
            className="icon-button"
            aria-label="Copy link"
            title="Copy link"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(
                  `${window.location.origin}/tasks/${task.id}`,
                );
                toast({ message: "Link copied" });
              } catch {
                toast({
                  message: "Could not copy link. Please try again.",
                  error: true,
                });
              }
            }}
          >
            <LinkIcon size={17} />
          </button>
          {(mobile || nativeShare) && (
            <button
              className="icon-button"
              aria-label="Share…"
              title="Share…"
              onClick={async () => {
                const url = `${window.location.origin}/tasks/${task.id}`;
                try {
                  if (navigator.share)
                    await navigator.share({
                      title: draft.title || "Untitled task",
                      url,
                    });
                  else {
                    await navigator.clipboard.writeText(url);
                    toast({ message: "Link copied" });
                  }
                } catch (error) {
                  if (error instanceof Error && error.name === "AbortError")
                    return;
                  try {
                    await navigator.clipboard.writeText(url);
                    toast({ message: "Link copied" });
                  } catch {
                    toast({
                      message: "Could not share link. Please try again.",
                      error: true,
                    });
                  }
                }
              }}
            >
              <Share2 size={17} />
            </button>
          )}
          <button
            className="icon-button"
            aria-label="Close task details"
            onClick={close}
          >
            <X size={19} />
          </button>
        </div>
        <div className="detail-scroll">
          {task.project && task.projectId !== activeProjectId && (
            <div className="detail-project-context">
              In {task.project.name} ·{" "}
              <button
                className="text-button"
                onClick={() =>
                  void onSwitchProject(task.projectId).catch(() => {})
                }
              >
                Switch to this project
              </button>
            </div>
          )}
          <div className="detail-title-row">
            <Checkbox
              checked={task.done}
              onClick={onToggle}
              color={taskAccent(task)}
              label={task.done ? "Reopen task" : "Complete task"}
            />
            <textarea
              rows={1}
              className="detail-title"
              aria-label="Task title"
              placeholder={task.attachments.length ? "Image" : "New task"}
              value={draft.title}
              onChange={(e) => edit("title", e.target.value)}
              onBlur={flush}
              style={{ height: "auto" }}
            />
          </div>
          <textarea
            ref={notesRef}
            rows={3}
            className="detail-notes"
            aria-label="Notes"
            placeholder="Add a note, a thought, a little context…"
            value={draft.notes}
            onChange={(e) => edit("notes", e.target.value)}
            onBlur={flush}
          />
          <div className="detail-section">
            {task.list === "later" ? (
              <div className="later-planning">
                <p>Later items aren’t assigned yet.</p>
                <button
                  className="primary-button"
                  onClick={() => patch({ list: "now", assignees: ["me"] })}
                >
                  Plan it → Now
                </button>
              </div>
            ) : (
              <>
                <label className="field-label">ASSIGNED TO</label>
                <div className="assignee-toggles">
                  {users.map((u) => (
                    <button
                      key={u.id}
                      className={
                        task.assignees.some((a) => a.id === u.id)
                          ? "is-assigned"
                          : ""
                      }
                      onClick={() =>
                        patch({
                          assignees: task.assignees.some((a) => a.id === u.id)
                            ? task.assignees
                                .filter((a) => a.id !== u.id)
                                .map((a) => a.id)
                            : [...task.assignees.map((a) => a.id), u.id],
                        })
                      }
                      aria-pressed={task.assignees.some((a) => a.id === u.id)}
                    >
                      <Avatar user={u} />
                      <span>
                        {u.displayName}
                        {u.id === users[0].id && <small> (you)</small>}
                      </span>
                      {task.assignees.some((a) => a.id === u.id) && (
                        <Check size={14} />
                      )}
                    </button>
                  ))}
                </div>
                <button
                  className="handoff-button"
                  onClick={() =>
                    patch({ assignees: [users[take ? 0 : 1].id] }, true)
                  }
                >
                  <Send size={15} />
                  <span>
                    {take ? "Take it" : `Pass to ${users[1].displayName}`}
                  </span>
                  <ArrowUpRight size={16} />
                </button>
              </>
            )}
          </div>
          <div className="detail-fields">
            <div className="detail-field">
              <span>
                <MoreHorizontal size={17} /> List
              </span>
              <div className="small-segment" aria-label="Task list">
                {(["now", "later"] as const).map((list) => (
                  <button
                    key={list}
                    aria-pressed={task.list === list}
                    className={task.list === list ? "selected" : ""}
                    onClick={() => patch({ list })}
                  >
                    {list === "now" ? "Now" : "Later"}
                  </button>
                ))}
              </div>
            </div>
            <label className="detail-field">
              <span>
                <CalendarDays size={17} /> Due date
              </span>
              <div className="date-field">
                <input
                  type="date"
                  aria-label="Due date"
                  value={task.dueDate || ""}
                  onChange={(e) => patch({ dueDate: e.target.value || null })}
                />
                {task.dueDate && (
                  <button
                    className="icon-button"
                    aria-label="Clear due date"
                    onClick={(e) => {
                      e.preventDefault();
                      patch({ dueDate: null });
                    }}
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
            </label>
            <div className="detail-field">
              <span>
                <Flag size={17} /> Priority
              </span>
              <div className="priority-picker">
                {([0, 1, 2, 3] as const).map((p) => (
                  <button
                    key={p}
                    aria-label={
                      [
                        "No priority",
                        "Low priority",
                        "Medium priority",
                        "High priority",
                      ][p]
                    }
                    aria-pressed={task.priority === p}
                    className={task.priority === p ? "selected" : ""}
                    onClick={() => patch({ priority: p })}
                  >
                    {p === 0 ? "—" : "!".repeat(p)}
                  </button>
                ))}
              </div>
            </div>
            <label className="detail-field">
              <span>
                <span
                  className="field-project-dot"
                  style={{
                    background: `var(--${task.project?.color || "gray"})`,
                  }}
                />{" "}
                Project
              </span>
              <select
                aria-label="Project"
                value={task.projectId || ""}
                onChange={(e) => {
                  const projectId = e.target.value || null;
                  patch({ projectId });
                }}
              >
                <option value="">No project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.emoji ? `${p.emoji} ` : ""}
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="detail-section">
            <label className="field-label" htmlFor="detail-tags">
              TAGS
            </label>
            <div className="tags-editor">
              {task.tags.map((t) => (
                <span className="editable-tag" key={t.id}>
                  #{t.name}
                  <button
                    aria-label={`Remove tag ${t.name}`}
                    onClick={() =>
                      patch({
                        tags: task.tags
                          .filter((tag) => tag.id !== t.id)
                          .map((tag) => tag.id),
                      })
                    }
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
              <input
                id="detail-tags"
                list="tag-options"
                aria-label="Add tag"
                placeholder="Add a tag…"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onBlur={() => {
                  if (tagInput.trim()) addTag(tagInput);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    addTag(tagInput);
                  }
                  if (e.key === "Backspace" && !tagInput && task.tags.length)
                    patch({ tags: task.tags.slice(0, -1).map((t) => t.id) });
                }}
              />
              <datalist id="tag-options">
                {tags
                  .filter((t) => !task.tags.some((a) => a.id === t.id))
                  .map((t) => (
                    <option key={t.id} value={t.name} />
                  ))}
              </datalist>
            </div>
          </div>
          <div className="detail-section attachment-section">
            <div className="section-label">
              <span>
                IMAGES{" "}
                {task.attachments.length > 0 && (
                  <small>{task.attachments.length}</small>
                )}
              </span>
              <button
                className="icon-button"
                aria-label="Attach photos"
                onClick={() => file.current?.click()}
                disabled={uploading}
              >
                {uploading ? (
                  <LoaderCircle className="spin" size={17} />
                ) : (
                  <PlusIcon />
                )}
              </button>
            </div>
            <input
              ref={file}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files?.length)
                  void onImages(Array.from(e.target.files));
                e.target.value = "";
              }}
            />
            {task.attachments.length ? (
              <div className="image-gallery">
                {task.attachments.map((a, index) => (
                  <button
                    key={a.id}
                    aria-label={`View ${a.filename}`}
                    onClick={() => setLightbox(index)}
                  >
                    <Image unoptimized fill src={a.url} alt={a.filename} />
                    <span className="filename" title={a.filename}>
                      <b>{a.filename.slice(0, -10)}</b>
                      <b>{a.filename.slice(-10)}</b>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <button
                className="add-images"
                onClick={() => file.current?.click()}
                disabled={uploading}
              >
                <ImagePlus size={23} />
                <span>
                  {uploading
                    ? "Adding your images…"
                    : "Drop a little inspiration here"}
                  <small>or choose photos</small>
                </span>
              </button>
            )}
          </div>
          <div className="detail-footer">
            <span>
              Created by {task.createdBy.displayName}
              <br />
              <small>{timeAgo(task.createdAt)}</small>
            </span>
            <button
              className="icon-button delete-task"
              aria-label="Delete task"
              onClick={onDelete}
            >
              <Trash2 size={17} />
            </button>
          </div>
        </div>
      </div>
      {lightbox !== null && task.attachments[lightbox] && (
        <Modal
          title={middleFilename(task.attachments[lightbox].filename)}
          className="lightbox"
          onClose={() => setLightbox(null)}
        >
          <ZoomableImage
            key={task.attachments[lightbox].id}
            width={task.attachments[lightbox].width || 800}
            height={task.attachments[lightbox].height || 600}
            src={task.attachments[lightbox].url}
            alt={task.attachments[lightbox].filename}
          />
          <div className="lightbox-actions">
            <button
              className="icon-button"
              aria-label="Previous image"
              disabled={lightbox === 0}
              onClick={() => setLightbox(lightbox - 1)}
            >
              <ChevronLeft />
            </button>
            <span>
              {lightbox + 1} of {task.attachments.length}
            </span>
            <button
              className="icon-button"
              aria-label="Next image"
              disabled={lightbox === task.attachments.length - 1}
              onClick={() => setLightbox(lightbox + 1)}
            >
              <ChevronRight />
            </button>
            <a
              className="icon-button"
              href={task.attachments[lightbox].url}
              target="_blank"
              rel="noreferrer"
              aria-label="Open original"
              title="Open original"
            >
              <ExternalLink size={18} />
            </a>
            <button
              className="text-danger"
              onClick={() => {
                setDeleteImage(task.attachments[lightbox].id);
                setLightbox(null);
              }}
            >
              <Trash2 size={16} /> Delete image
            </button>
          </div>
        </Modal>
      )}
      {deleteImage && (
        <Confirm
          title="Delete this image?"
          text="It will be removed from this task for both of you."
          onClose={() => setDeleteImage(null)}
          onConfirm={() => {
            void onDeleteImage(deleteImage).catch((err) =>
              toast({ message: err.message, error: true }),
            );
          }}
        />
      )}
    </>
  );
}
function PlusIcon() {
  return <ImagePlus size={16} />;
}

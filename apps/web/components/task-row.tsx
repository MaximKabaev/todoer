"use client";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronRight, Flag, ImageIcon } from "lucide-react";
import type { Task, TaskInput } from "@/lib/api";
import { dueLabel, taskAccent, today } from "@/lib/utils";
import { Avatar, Checkbox } from "./ui";
export function TaskRow({
  task,
  selected,
  completing,
  onOpen,
  onToggle,
  onEdit,
  onDelete,
}: {
  task: Task;
  selected: boolean;
  completing: boolean;
  onOpen: () => void;
  onToggle: () => void;
  onEdit: (input: TaskInput) => Promise<unknown>;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);
  const input = useRef<HTMLInputElement>(null);
  const original = useRef(task.title);
  useEffect(() => {
    if (editing) input.current?.focus();
  }, [editing]);
  const hasMeta =
    task.assignees.length > 0 ||
    task.tags.length > 0 ||
    task.dueDate ||
    task.project ||
    task.priority > 0 ||
    task.attachments.length > 0;
  return (
    <div
      className={`task-row ${selected ? "selected" : ""} ${completing ? "completing" : ""} ${task.done ? "done" : ""} ${task.id.startsWith("pending-") ? "pending" : ""}`}
      tabIndex={0}
      role="group"
      aria-label={task.title || "New task"}
      data-task-id={task.id}
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest("button,input,a")) onOpen();
      }}
      onKeyDown={(e) => {
        if ((e.target as HTMLElement).closest("input,button")) return;
        if (e.key === "Enter") {
          e.preventDefault();
          onOpen();
        }
        if (e.key === " ") {
          e.preventDefault();
          onToggle();
        }
        if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          onDelete();
        }
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const rows = Array.from(
            document.querySelectorAll<HTMLElement>("[data-task-id]"),
          );
          rows[
            rows.indexOf(e.currentTarget) + (e.key === "ArrowDown" ? 1 : -1)
          ]?.focus();
        }
      }}
    >
      <Checkbox
        checked={task.done}
        label={`${task.done ? "Reopen" : "Complete"} ${task.title || "task"}`}
        onClick={onToggle}
        color={taskAccent(task)}
      />
      <div className="task-content">
        {editing ? (
          <input
            ref={input}
            className="inline-title"
            aria-label="Edit task title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onBlur={() => {
              setEditing(false);
              if (title !== original.current)
                void onEdit({ title }).catch(() => {});
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") input.current?.blur();
              if (e.key === "Escape") {
                setTitle(original.current);
                setEditing(false);
              }
            }}
          />
        ) : (
          <button
            aria-label={`Edit title: ${task.title || "New task"}`}
            className={`row-title ${!task.title ? "untitled" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              if (task.id.startsWith("pending-")) return;
              original.current = task.title;
              setTitle(task.title);
              setEditing(true);
            }}
          >
            {task.title || "New task"}
          </button>
        )}
        {hasMeta && (
          <div className="task-meta">
            {task.assignees.length > 0 && (
              <span
                className="assignee-stack"
                role="img"
                aria-label={`Assigned to ${task.assignees.map((u) => u.displayName).join(" and ")}`}
              >
                {task.assignees.map((u) => (
                  <Avatar key={u.id} user={u} small />
                ))}
              </span>
            )}
            {task.project && (
              <span className="meta-project">
                <span style={{ background: `var(--${task.project.color})` }} />
                {task.project.name}
              </span>
            )}
            {task.tags.slice(0, 2).map((tag) => (
              <span className="tag-pill" key={tag.id}>
                #{tag.name}
              </span>
            ))}
            {task.tags.length > 2 && <span>+{task.tags.length - 2}</span>}
            {task.dueDate && (
              <span
                className={`meta-date ${!task.done && task.dueDate < today() ? "overdue" : task.dueDate === today() ? "due-today" : ""}`}
              >
                <CalendarDays size={12} />
                {dueLabel(task.dueDate)}
              </span>
            )}
            {task.priority > 0 && (
              <span
                className={`meta-priority priority-${task.priority}`}
                aria-label={`Priority ${task.priority}`}
              >
                <Flag size={11} fill="currentColor" />
                {"!".repeat(task.priority)}
              </span>
            )}
            {task.attachments.length > 0 && (
              <span className="meta-images">
                <ImageIcon size={12} />
                {task.attachments.length}
              </span>
            )}
          </div>
        )}
      </div>
      {task.attachments.length > 0 && (
        <span className="row-thumbnail">
          <Image
            unoptimized
            width={800}
            height={600}
            src={task.attachments[0].url}
            alt=""
          />
        </span>
      )}
      <button
        className="icon-button row-open"
        aria-label={`Open ${task.title || "task"} details`}
        onClick={onOpen}
      >
        <ChevronRight size={17} />
      </button>
    </div>
  );
}

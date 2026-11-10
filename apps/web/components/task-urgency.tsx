"use client";
import { AlarmClock, Flag } from "lucide-react";
import type { Task } from "@/lib/api";
import { useLocalDay } from "@/hooks/use-local-day";
import { deadlineNudge } from "@/lib/task-dates";

export function TaskUrgency({ task }: { task: Task }) {
  const day = useLocalDay();
  const deadline = deadlineNudge(task, day);
  if (!task.priority && !deadline) return null;
  return (
    <div className={`task-urgency ${task.done ? "urgency-done" : ""}`}>
      {task.priority > 0 && (
        <span className={`priority-heading priority-${task.priority}`}>
          <Flag size={13} fill="currentColor" aria-hidden="true" />
          {["", "Low priority", "Medium priority", "High priority"][task.priority]}
        </span>
      )}
      {deadline && (
        <div className={`deadline-nudge deadline-${deadline.level}`}>
          <AlarmClock size={14} aria-hidden="true" />
          <span><strong>{deadline.label}</strong><span className="deadline-message">{deadline.message}</span></span>
        </div>
      )}
    </div>
  );
}

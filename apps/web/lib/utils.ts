import type { Task } from "./api";
export const colors = [
  "blue",
  "purple",
  "pink",
  "red",
  "orange",
  "yellow",
  "green",
  "teal",
  "gray",
] as const;
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((x) => x[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export function dueLabel(date: string) {
  if (date === today()) return "Today";
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (
    date ===
    `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`
  )
    return "Tomorrow";
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
export function timeAgo(date: string) {
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - new Date(date).getTime()) / 60000),
  );
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
export const taskAccent = (task: Task) =>
  `var(--${task.project?.color || "blue"})`;
export function imageFiles(files: File[]) {
  const allowed = /^(image\/(png|jpeg|gif|webp|heic|heif))$/i;
  if (
    files.some((f) => !allowed.test(f.type) && !/\.(heic|heif)$/i.test(f.name))
  )
    throw new Error("Choose PNG, JPEG, GIF, WebP, or HEIC images.");
  if (files.some((f) => f.size > 20 * 1024 * 1024))
    throw new Error("Each image must be 20 MB or smaller.");
  return files;
}

export function middleFilename(name: string, maxLength = 30) {
  if (name.length <= maxLength) return name;
  const tail = Math.min(10, Math.floor(maxLength / 3));
  return `${name.slice(0, maxLength - tail - 1)}…${name.slice(-tail)}`;
}

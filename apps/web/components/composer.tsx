"use client";
import { forwardRef, useRef, useState } from "react";
import { ArrowUp, Plus } from "lucide-react";
import type { TaskInput, User } from "@/lib/api";
import { parseQuickSyntax } from "@/lib/quick-syntax";
export const Composer = forwardRef<
  HTMLInputElement,
  {
    users: [User, User];
    onCreate: (input: TaskInput, open?: boolean) => Promise<unknown>;
    onImages: (files: File[]) => Promise<unknown>;
    uploading: boolean;
    later?: boolean;
  }
>(function Composer(
  { users, onCreate, onImages, uploading, later = false },
  ref,
) {
  const [value, setValue] = useState("");
  const localRef = useRef<HTMLInputElement | null>(null);
  const parsed = parseQuickSyntax(value, users, { assign: !later });
  async function submit(open = false) {
    if (!value.trim() && !open) return;
    const captured = value;
    setValue("");
    localRef.current?.focus();
    try {
      await onCreate({ title: parsed.title, ...parsed.fields }, open);
    } catch {
      setValue(captured);
    }
  }
  return (
    <div className="composer-area">
      <form
        className={`composer ${uploading ? "uploading" : ""}`}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        onPaste={(e) => {
          const files = Array.from(e.clipboardData.files);
          if (files.length) {
            e.preventDefault();
            void onImages(files);
          }
        }}
      >
        <button
          type="button"
          aria-label="Create an empty task and open details"
          className="composer-plus"
          onClick={() => void submit(true)}
        >
          <Plus size={22} />
        </button>
        <div className="composer-input-wrap">
          <input
            ref={(node) => {
              localRef.current = node;
              if (typeof ref === "function") ref(node);
              else if (ref) ref.current = node;
            }}
            aria-label="New task"
            placeholder={
              uploading
                ? "Adding your images…"
                : "New task. What’s on your mind?"
            }
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoComplete="off"
          />
          {parsed.chips.length > 0 && (
            <div className="syntax-chips">
              {parsed.chips.map((chip) => (
                <span key={chip}>{chip}</span>
              ))}
              <span className="parsed-preview">
                {parsed.title || "Untitled task"}
              </span>
            </div>
          )}
        </div>
        <input
          type="file"
          accept="image/*"
          multiple
          hidden
          aria-label="Attach images to a new task"
          onChange={(e) => {
            if (e.target.files?.length)
              void onImages(Array.from(e.target.files));
            e.target.value = "";
          }}
        />
        {value.trim() ? (
          <button type="submit" aria-label="Add task" className="submit-task">
            <ArrowUp size={18} />
          </button>
        ) : (
          <kbd className="composer-shortcut">↵</kbd>
        )}
      </form>
    </div>
  );
});

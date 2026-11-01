"use client";
import { Check, X } from "lucide-react";
import localFont from "next/font/local";
import { initials } from "@/lib/utils";
import type { User } from "@/lib/api";
import { useDialog } from "@/hooks/use-dialog";
const brandFont = localFont({
  src: "../assets/fonts/nunito.ttf",
  weight: "900",
  display: "swap",
});
export function Avatar({
  user,
  small = false,
}: {
  user: User;
  small?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      title={user.displayName}
      className={`avatar ${small ? "avatar-small" : ""}`}
      style={{ "--accent": `var(--${user.color})` } as React.CSSProperties}
    >
      {initials(user.displayName)}
    </span>
  );
}
export function Brand() {
  return (
    <div className={`brand ${brandFont.className}`}>
      <svg className="brand-icon" viewBox="0 0 64 48" aria-hidden="true">
        <rect x="25" y="4" width="39" height="18" rx="9" />
        <rect x="0" y="26" width="52" height="18" rx="9" />
      </svg>
      <span>
        todoer<span className="brand-period">.</span>
      </span>
    </div>
  );
}
export function Checkbox({
  checked,
  onClick,
  label,
  color,
}: {
  checked: boolean;
  onClick: () => void;
  label: string;
  color?: string;
}) {
  return (
    <button
      className={`task-check ${checked ? "checked" : ""}`}
      style={{ "--accent": color || "var(--blue)" } as React.CSSProperties}
      onClick={onClick}
      aria-label={label}
      aria-pressed={checked}
    >
      {checked && <Check size={15} strokeWidth={3} />}
    </button>
  );
}
export function Modal({
  title,
  onClose,
  children,
  className = "",
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useDialog(onClose);
  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`modal ${className}`}
      >
        <div className="modal-header">
          <h2>{title}</h2>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
export function Confirm({
  title,
  text,
  label = "Delete",
  onConfirm,
  onClose,
}: {
  title: string;
  text: string;
  label?: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title={title} onClose={onClose} className="confirm-modal">
      <p>{text}</p>
      <div className="confirm-actions">
        <button className="secondary-button" onClick={onClose}>
          Cancel
        </button>
        <button
          className="danger-button"
          onClick={() => {
            onConfirm();
            onClose();
          }}
        >
          {label}
        </button>
      </div>
    </Modal>
  );
}
export function Skeleton() {
  return (
    <div className="skeleton-list" aria-label="Loading tasks" role="status">
      {[1, 2, 3, 4].map((i) => (
        <div className="skeleton-row" key={i}>
          <span />
          <div>
            <i style={{ width: `${55 + i * 8}%` }} />
            <i />
          </div>
        </div>
      ))}
    </div>
  );
}

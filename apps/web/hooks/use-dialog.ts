"use client";
import { useEffect, useRef } from "react";
export function useDialog(onClose: () => void, trap = true) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const root = ref.current;
    const focusable = () =>
      Array.from(
        root?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), textarea, select, a[href], [tabindex="0"]',
        ) || [],
      ).filter((el) => el.getClientRects().length > 0);
    if (trap)
      (
        root?.querySelector<HTMLElement>("[data-autofocus]") || focusable()[0]
      )?.focus();
    const key = (e: KeyboardEvent) => {
      // Only the top dialog handles keys when a confirmation or lightbox is open.
      if (
        Array.from(document.querySelectorAll('[role="dialog"]')).at(-1) !== root
      )
        return;
      if (e.key === "Escape") {
        e.preventDefault();
        close.current();
      }
      if (trap && e.key === "Tab") {
        const elements = focusable();
        const first = elements[0];
        const last = elements.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        }
        if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, [trap]);
  return ref;
}

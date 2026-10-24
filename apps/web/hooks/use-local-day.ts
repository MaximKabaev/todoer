"use client";
import { useSyncExternalStore } from "react";
import { today } from "@/lib/utils";
const subscribe = (notify: () => void) => {
  const timer = setInterval(notify, 30000);
  document.addEventListener("visibilitychange", notify);
  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", notify);
  };
};
// A deterministic SSR snapshot; switch to the browser's day after hydration.
export const useLocalDay = () =>
  useSyncExternalStore(subscribe, today, () => "");

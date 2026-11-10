"use client";
import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import { SWRConfig } from "swr";
import { Check, X, AlertCircle, PartyPopper, Trophy } from "lucide-react";
import { ApiError, request } from "@/lib/api";
type Toast = {
  message: string;
  error?: boolean;
  celebration?: "win" | "milestone";
  action?: { label: string; run: () => void };
};
const ToastContext = createContext<(toast: Toast) => void>(() => {});
export const useToast = () => useContext(ToastContext);
export function Providers({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<(Toast & { id: number }) | null>(null);
  const sequence = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = useCallback((value: Toast) => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ ...value, id: ++sequence.current });
    timer.current = setTimeout(
      () => setToast(null),
      value.action ? 6500 : 4500,
    );
  }, []);
  return (
    <SWRConfig
      value={{
        fetcher: request,
        refreshInterval: 10000,
        revalidateOnFocus: true,
        shouldRetryOnError: (error) =>
          !(error instanceof ApiError && [401, 404].includes(error.status)),
        onError: (error) => {
          if (!(error instanceof ApiError && [401, 404].includes(error.status)))
            notify({
              message:
                error.message || "Connection interrupted. Please try again.",
              error: true,
            });
        },
      }}
    >
      <ToastContext.Provider value={notify}>
        {children}
        {toast && (
          <div
            key={toast.id}
            className={`toast ${toast.error ? "toast-error" : ""} ${toast.celebration ? `toast-celebration ${toast.celebration}` : ""}`}
            role={toast.error ? "alert" : "status"}
          >
            {toast.celebration && <div className="completion-confetti" aria-hidden="true">
              {Array.from({ length: toast.celebration === "milestone" ? 18 : 10 }, (_, i) =>
                <i key={i} style={{ "--piece": i } as React.CSSProperties} />)}
            </div>}
            {toast.error ? <AlertCircle size={18} /> : toast.celebration === "milestone" ? <Trophy size={23} /> : toast.celebration ? <PartyPopper size={21} /> : <Check size={18} />}
            <span>{toast.message}</span>
            {toast.action && (
              <button
                onClick={() => {
                  toast.action?.run();
                  setToast(null);
                }}
              >
                {toast.action.label}
              </button>
            )}
            <button
              className="icon-button"
              aria-label="Dismiss notification"
              onClick={() => setToast(null)}
            >
              <X size={15} />
            </button>
          </div>
        )}
      </ToastContext.Provider>
    </SWRConfig>
  );
}

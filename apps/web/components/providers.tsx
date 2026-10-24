"use client";
import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import { SWRConfig } from "swr";
import { Check, X, AlertCircle } from "lucide-react";
import { ApiError, request } from "@/lib/api";
type Toast = {
  message: string;
  error?: boolean;
  action?: { label: string; run: () => void };
};
const ToastContext = createContext<(toast: Toast) => void>(() => {});
export const useToast = () => useContext(ToastContext);
export function Providers({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = useCallback((value: Toast) => {
    if (timer.current) clearTimeout(timer.current);
    setToast(value);
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
            className={`toast ${toast.error ? "toast-error" : ""}`}
            role={toast.error ? "alert" : "status"}
          >
            {toast.error ? <AlertCircle size={18} /> : <Check size={18} />}
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

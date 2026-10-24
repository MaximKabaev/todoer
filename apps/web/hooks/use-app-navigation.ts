"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { normalizeAppUrl } from "@/lib/routes";

type Entry = { url: string; background?: string; back: boolean };
// Only entries made by this mounted app may send Close/Lists through browser Back.
// A fresh deep link (including a refresh) always has a deterministic list fallback.
export function useAppNavigation() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams().toString();
  const url = pathname + (params ? `?${params}` : "");
  const [entry, setEntry] = useState<Entry>({ url, back: false });
  useEffect(() => {
    if (entry.url === url)
      window.history.replaceState(
        { ...window.history.state, todoer: entry },
        "",
      );
  }, [entry, url]);
  useEffect(() => {
    const pop = (event: PopStateEvent) => {
      setEntry(
        event.state?.todoer || {
          url: location.pathname + location.search,
          back: false,
        },
      );
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  const navigate = useCallback(
    (target: string, options?: { replace?: boolean; background?: string }) => {
      target = normalizeAppUrl(target);
      if (target === url || target === entry.url) return;
      setEntry({
        url: target,
        background: options?.background,
        back: options?.replace ? entry.back : true,
      });
      router[options?.replace ? "replace" : "push"](target, { scroll: false });
    },
    [router, url, entry.back, entry.url],
  );
  const back = useCallback(
    (fallback: string, replace = false) => {
      if (entry.url === url && entry.back) router.back();
      else navigate(fallback, { replace });
    },
    [entry.url, entry.back, url, router, navigate],
  );
  const background = entry.url === url ? entry.background : undefined;
  return useMemo(
    () => ({ url, pathname, background, navigate, back }),
    [url, pathname, background, navigate, back],
  );
}

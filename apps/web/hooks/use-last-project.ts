"use client";
import { useRef } from "react";
import { useSWRConfig } from "swr";
import { api, type CurrentUser, type User } from "@/lib/api";
import { useToast } from "@/components/providers";

type Me = { user: CurrentUser; teammate: User };
export function useLastProject() {
  const { mutate } = useSWRConfig();
  const toast = useToast();
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const version = useRef(0);
  return (lastProjectId: string | null) => {
    const revision = ++version.current;
    void mutate<Me>(
      "/api/me",
      (data) => data && ({ ...data, user: { ...data.user, lastProjectId } }),
      { revalidate: false },
    );
    // Preserve the user's pick order even when a previous request is slow.
    queue.current = queue.current.catch(() => {}).then(async () => {
      try {
        await api.updateMe({ lastProjectId });
      } catch {
        if (version.current === revision)
          toast({ message: "Could not remember your project. Please try again.", error: true });
      } finally {
        if (version.current === revision) await mutate("/api/me");
      }
    });
  };
}

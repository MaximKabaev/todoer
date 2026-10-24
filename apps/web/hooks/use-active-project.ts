"use client";
import { useCallback, useRef } from "react";
import { useSWRConfig } from "swr";
import { api, workspaceKey, type CurrentUser, type User } from "@/lib/api";
import { useToast } from "@/components/providers";

type Me = { user: CurrentUser; teammate: User };
export function useActiveProject() {
  const { mutate } = useSWRConfig();
  const toast = useToast();
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const version = useRef(0);
  return useCallback(
    (activeProjectId: string | null) => {
      const revision = ++version.current;
      void mutate<Me>(
        "/api/me",
        (data) =>
          data && {
            ...data,
            user: { ...data.user, activeProjectId },
          },
        { revalidate: false },
      );
      // Serialize writes so the server keeps the last pick even on a slow connection.
      const operation = queue.current
        .catch(() => {})
        .then(async () => {
          try {
            await api.updateMe({ activeProjectId });
          } catch (error) {
            if (version.current === revision)
              toast({
                message: "Could not switch project. Please try again.",
                error: true,
              });
            throw error;
          } finally {
            if (version.current === revision) {
              await mutate("/api/me");
              await mutate(workspaceKey);
            }
          }
        });
      queue.current = operation;
      return operation;
    },
    [mutate, toast],
  );
}

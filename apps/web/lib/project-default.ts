import type { Project } from "./api";

// undefined means the catalog has not loaded; null means a deliberate absence.
export function defaultProjectId(
  projects: Project[] | undefined,
  lastProjectId: string | null,
  viewProjectId?: string,
): string | null | undefined {
  if (!projects) return undefined;
  if (viewProjectId && projects.some((p) => p.id === viewProjectId))
    return viewProjectId;
  if (lastProjectId && projects.some((p) => p.id === lastProjectId))
    return lastProjectId;
  return projects.length === 1 ? projects[0].id : null;
}

export function captureProjectId(
  projects: Project[],
  lastProjectId: string | null,
  viewProjectId?: string,
  override?: string | null,
): string | null {
  if (!viewProjectId && override === null) return null;
  if (!viewProjectId && override && projects.some((p) => p.id === override))
    return override;
  return defaultProjectId(projects, lastProjectId, viewProjectId) ?? null;
}

export type Color =
  | "blue"
  | "purple"
  | "pink"
  | "red"
  | "orange"
  | "yellow"
  | "green"
  | "teal"
  | "gray";
export type User = {
  id: string;
  username: string;
  displayName: string;
  color: Color;
};
export type EmailPreferences = {
  assigned: boolean;
  completed: boolean;
  updates: boolean;
  achievements: boolean;
  afk: boolean;
  seasons: boolean;
};
export type CurrentUser = User & {
  birthday?: string | null;
  githubLogin: string | null;
  activeProjectId: string | null;
  email?: string | null;
  emailNotifications?: boolean;
  emailPreferences: EmailPreferences;
};
export type Project = {
  id: string;
  name: string;
  color: Color;
  emoji: string | null;
  /** owner/name, in display order. A project can span several repos (e.g. backend + frontend). */
  githubRepos: string[];
  /** Legacy: first of githubRepos, or null. Prefer githubRepos. */
  githubRepo: string | null;
  position: number;
  createdAt: string;
  openCount?: number;
};
export type Tag = { id: string; name: string; color: Color; count?: number };
export type Attachment = {
  id: string;
  taskId?: string;
  filename: string;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
  url: string;
  createdAt?: string;
};
export type Task = {
  id: string;
  webUrl?: string;
  resurfacedAt?: string | null;
  title: string;
  notes: string;
  done: boolean;
  doneAt: string | null;
  list: "now" | "later";
  dueDate: string | null;
  priority: 0 | 1 | 2 | 3;
  projectId: string | null;
  project: Pick<Project, "id" | "name" | "color" | "emoji"> | null;
  createdBy: User;
  // Set only on tasks another server created with a create-only token.
  reportedBy?: string | null;
  assignees: User[];
  tags: Tag[];
  attachments: Attachment[];
  position: number;
  createdAt: string;
  updatedAt: string;
};
export type TaskInput = Partial<
  Pick<
    Task,
    | "title"
    | "notes"
    | "done"
    | "list"
    | "dueDate"
    | "priority"
    | "projectId"
    | "position"
  >
> & {
  assignees?: string[];
  tags?: string[];
  addAssignees?: string[];
  removeAssignees?: string[];
  addTags?: string[];
  removeTags?: string[];
};
export type View =
  | "mine"
  | "mine_created"
  | "mine_from_teammate"
  | "teammate"
  | "later"
  | "unassigned"
  | "completed"
  | "all";
export type TaskQuery = {
  view?: View;
  assignee?: string;
  createdBy?: string;
  list?: "now" | "later";
  done?: "true" | "false" | "all";
  projectId?: string;
  tag?: string;
  q?: string;
  limit?: number;
};
export type Counts = {
  mine: number;
  mineCreated: number;
  mineFromTeammate: number;
  teammate: number;
  later: number;
  unassigned: number;
  completed: number;
};
export type ScoreChange = { before: number; after: number; delta: number };
export type ScoreEntry = {
  user: User;
  score: number;
  label: string;
  trend: number;
  doneThisWeek: number;
  overdue: number;
  afkPenaltyThisWeek: number;
  activity: {
    day: string;
    completed: number;
    commits: number;
    merges: number;
    active: boolean;
    atRisk: boolean;
    githubLinked: boolean;
  };
};
export type SeasonFinal = { score: number; label: string; carriedOver: number };
export type SeasonResult = {
  id: string;
  number: number;
  name: string;
  startsAt: string;
  endsAt: string;
  winner: "me" | "teammate" | null;
  me: SeasonFinal;
  teammate: SeasonFinal | null;
};
export type Season = {
  id: string;
  number: number;
  name: string;
  startsAt: string;
  endsAt: string;
  daysLeft: number;
  tally: { me: number; teammate: number; ties: number };
  previous: SeasonResult | null;
};
export type Score = {
  me: ScoreEntry;
  teammate: ScoreEntry | null;
  leader: "me" | "teammate" | null;
  lead: number;
  season: Season;
};
export type StatsTotals = {
  completed: number;
  onTime: number;
  onTimeRate: number | null;
  afkDays: number;
  afkPoints: number;
  commits: number;
  merges: number;
  activeDays: number;
};
export type PersonStats = {
  user: User;
  score: number;
  label: string;
  open: number;
  overdue: number;
  best: { score: number; day: string } | null;
  worst: { score: number; day: string } | null;
  streak: { current: number; best: number };
  bestDay: { day: string; completed: number } | null;
  season: StatsTotals & { daysLed: number };
  allTime: StatsTotals & {
    created: number;
    assignedToTeammate: number;
    medianHoursToDone: number | null;
  };
  /** Completions by weekday, Monday first. */
  weekdays: number[];
  /** Completions by local hour, 0-23. */
  hours: number[];
  /** The last 182 days, oldest first. */
  activity: { day: string; completed: number; commits: number; merges: number }[];
};
export type AchievementState = {
  unlocked: boolean;
  unlockedAt: string | null;
  progress: { current: number; target: number } | null;
};
export type Achievement = {
  id: string;
  category: "score" | "streak" | "volume" | "punctuality" | "competition" | "team" | "code" | "fun" | "secret";
  hidden: boolean;
  /** Badge image path. Hidden ones use a hash-named file, so showing it never gives the secret away. */
  art: string;
  title: string | null;
  description: string | null;
  target: number | null;
  me: AchievementState;
  teammate: AchievementState | null;
};
export type Stats = {
  achievements: Achievement[];
  generatedAt: string;
  timezone: string;
  season: Season;
  /** Finished seasons, newest first. */
  seasons: SeasonResult[];
  /** End-of-day scores, oldest first, ending today. */
  history: { day: string; me: number; teammate: number | null }[];
  me: PersonStats;
  teammate: PersonStats | null;
};
export type AgentToken = {
  id: string;
  name: string;
  scope: "full" | "create";
  projectId: string | null;
  createdAt: string;
  lastUsedAt?: string | null;
};
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: {
      ...(init?.body && !(init.body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const error = await res
      .json()
      .catch(() => ({ error: "Unable to connect. Please try again." }));
    throw new ApiError(
      res.status,
      error.error || "Something went wrong.",
      error.details,
    );
  }
  return res.json() as Promise<T>;
}
const json = (method: string, data?: unknown): RequestInit => ({
  method,
  ...(data === undefined ? {} : { body: JSON.stringify(data) }),
});
export const scopeKey = (path: string, projectId?: string | null) =>
  projectId ? `${path}?${new URLSearchParams({ projectId })}` : path;
export const workspaceKey = (key: unknown) =>
  typeof key === "string" &&
  ["/api/tasks", "/api/counts", "/api/score", "/api/stats", "/api/tags", "/api/projects"].some(
    (path) => key === path || key.startsWith(`${path}?`),
  );
export const taskKey = (query: TaskQuery = {}) =>
  `/api/tasks?${new URLSearchParams(
    Object.entries(query)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, String(v)]),
  )}`;
export function multipart(input: TaskInput, files: File[]) {
  const body = new FormData();
  Object.entries(input).forEach(([key, value]) => {
    if (value !== undefined)
      body.append(
        key,
        Array.isArray(value) || value === null
          ? JSON.stringify(value)
          : String(value),
      );
  });
  files.forEach((file) => body.append("files", file));
  return body;
}
export const api = {
  health: () => request<{ ok: true }>("/api/health"),
  agent: async () => {
    const res = await fetch("/agent");
    if (!res.ok)
      throw new ApiError(res.status, "Could not load agent instructions.");
    return res.text();
  },
  login: (username: string, password: string) =>
    request<{ user: User }>(
      "/api/auth/login",
      json("POST", { username, password }),
    ),
  logout: () => request<{ ok: true }>("/api/auth/logout", json("POST")),
  me: () => request<{ user: CurrentUser; teammate: User }>("/api/me"),
  updateMe: (input: {
    birthday?: string | null;
    githubLogin?: string | null;
    activeProjectId?: string | null;
    email?: string | null;
    emailNotifications?: boolean;
    emailPreferences?: Partial<EmailPreferences>;
    displayName?: string;
    password?: string;
    currentPassword?: string;
  }) => request<{ user: CurrentUser }>("/api/me", json("PATCH", input)),
  users: () => request<{ users: User[] }>("/api/users"),
  tokens: () => request<{ tokens: AgentToken[] }>("/api/tokens"),
  // With a projectId the token is create-only: it can add tasks to that project and nothing else.
  createToken: (name?: string, projectId?: string) =>
    request<{ token: AgentToken; secret: string }>(
      "/api/tokens",
      json("POST", { name, ...(projectId ? { scope: "create", projectId } : {}) }),
    ),
  revokeToken: (id: string) =>
    request<{ ok: true }>(`/api/tokens/${id}`, json("DELETE")),
  tasks: (query?: TaskQuery) => request<{ tasks: Task[] }>(taskKey(query)),
  task: (id: string) => request<{ task: Task }>(`/api/tasks/${id}`),
  createTask: (input: TaskInput = {}, files: File[] = []) =>
    request<{ task: Task }>(
      "/api/tasks",
      files.length
        ? { method: "POST", body: multipart(input, files) }
        : json("POST", input),
    ),
  updateTask: (id: string, input: TaskInput) =>
    request<{ task: Task; scoreChange?: ScoreChange }>(`/api/tasks/${id}`, json("PATCH", input)),
  handoff: (id: string, to?: string) =>
    request<{ task: Task }>(`/api/tasks/${id}/handoff`, json("POST", { to })),
  deleteTask: (id: string) =>
    request<{ ok: true }>(`/api/tasks/${id}`, json("DELETE")),
  attach: (id: string, files: File[]) =>
    request<{ task: Task }>(`/api/tasks/${id}/attachments`, {
      method: "POST",
      body: multipart({}, files),
    }),
  deleteAttachment: (id: string) =>
    request<{ ok: true }>(`/api/attachments/${id}`, json("DELETE")),
  attachmentUrl: (id: string) => `/api/attachments/${id}/file`,
  projects: () => request<{ projects: Project[] }>("/api/projects"),
  createProject: (input: Partial<Pick<Project, "name" | "color" | "emoji" | "githubRepos">>) =>
    request<{ project: Project }>("/api/projects", json("POST", input)),
  updateProject: (
    id: string,
    input: Partial<Pick<Project, "name" | "color" | "emoji" | "position" | "githubRepos">>,
  ) =>
    request<{ project: Project }>(`/api/projects/${id}`, json("PATCH", input)),
  deleteProject: (id: string) =>
    request<{ ok: true }>(`/api/projects/${id}`, json("DELETE")),
  tags: (projectId?: string) =>
    request<{ tags: Tag[] }>(scopeKey("/api/tags", projectId)),
  createTag: (name: string, color?: Color) =>
    request<{ tag: Tag }>("/api/tags", json("POST", { name, color })),
  updateTag: (id: string, input: Partial<Pick<Tag, "name" | "color">>) =>
    request<{ tag: Tag }>(`/api/tags/${id}`, json("PATCH", input)),
  deleteTag: (id: string) =>
    request<{ ok: true }>(`/api/tags/${id}`, json("DELETE")),
  counts: (projectId?: string) =>
    request<Counts>(scopeKey("/api/counts", projectId)),
};

function normalizeGithubRepo(value) {
  if (value === null || value === undefined) return null;
  const invalid = () => Object.assign(new Error("Invalid GitHub repository. Use owner/name or a GitHub URL."), { status: 400 });
  if (typeof value !== "string" || value.trim().length > 300) throw invalid();
  const repo = value.trim()
    .replace(/^(https?:\/\/)?(www\.)?github\.com\//i, "")
    .replace(/\/+$/, "")
    .replace(/\.git$/i, "");
  if (!repo) return null;
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}\/[A-Za-z0-9._-]{1,100}$/.test(repo)) throw invalid();
  return repo;
}
// Development mock never queues or delivers email, including Later assignment digests.
/** Development-only, in-memory SPEC.md API. Never imported by the app. */
import { defaultDate, scoreEntry } from "./mock-score.mjs";
import { createServer } from "node:http";
import { randomUUID, randomBytes, randomInt } from "node:crypto";
const port = Number(process.env.MOCK_PORT || 4000);
const stamp = () => new Date().toISOString();
const users = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    username: "maxim",
    displayName: "Maxim",
    color: "blue",
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    username: "teammate",
    displayName: "Teammate",
    color: "orange",
  },
];
const activeProjects = new Map(users.map((u) => [u.id, null]));
const emails = new Map(users.map((u) => [u.id, `${u.username}@example.com`]));
const emailNotifications = new Map(users.map((u) => [u.id, true]));
const githubLogins = new Map(users.map((u) => [u.id, null]));
const currentUser = (u) => ({
  ...u,
  githubLogin: githubLogins.get(u.id),
  activeProjectId: activeProjects.get(u.id),
  email: emails.get(u.id),
  emailNotifications: emailNotifications.get(u.id),
});
const passwords = new Map(users.map((u) => [u.id, "todoer"]));
const sessions = new Map();
const tokenSecrets = new Map();
const files = new Map();
const projects = [
  {
    id: randomUUID(),
    name: "A better todoer",
    githubRepo: "MaximKabaev/todoer",
    color: "purple",
    emoji: "✦",
    position: 3,
    createdAt: stamp(),
  },
  {
    id: randomUUID(),
    name: "Home & life",
    githubRepo: null,
    color: "teal",
    emoji: "⌂",
    position: 2,
    createdAt: stamp(),
  },
  {
    id: randomUUID(),
    name: "Weekend plans",
    githubRepo: null,
    color: "orange",
    emoji: "☀",
    position: 1,
    createdAt: stamp(),
  },
];
const tags = [
  { id: randomUUID(), name: "ideas", color: "purple" },
  { id: randomUUID(), name: "little-things", color: "teal" },
  { id: randomUUID(), name: "together", color: "orange" },
];
const date = new Date();
const localDate = (d) => d.toISOString().slice(0, 10);
const today = localDate(date);
date.setDate(date.getDate() + 1);
const tomorrow = localDate(date);
date.setDate(date.getDate() - 2);
const yesterday = localDate(date);
const tasks = [];
function fixture(title, options = {}) {
  const task = {
    id: randomUUID(),
    title,
    notes: "",
    done: false,
    doneAt: null,
    list: "now",
    dueDate: null,
    priority: 0,
    projectId: null,
    createdBy: users[0],
    assignees: [users[0]],
    tags: [],
    attachments: [],
    position: Date.now() - tasks.length * 1000,
    createdAt: new Date(
      options.doneAt
        ? Math.min(Date.now() - (tasks.length + 1) * 3600000, Date.parse(options.doneAt) - 3600000)
        : Date.now() - (tasks.length + 1) * 3600000,
    ).toISOString(),
    updatedAt: stamp(),
    ...options,
  };
  if (task.list === "later") task.assignees = [];
  task.resurfacedAt = null;
  task.laterSince = task.list === "later" ? task.createdAt : null;
  tasks.push(task);
  return task;
}
fixture("Make a little room for the good stuff", {
  notes:
    "A calmer homepage, a little more whitespace, and a place for the things that matter.\n\nLet’s keep it simple and make it feel like us.",
  projectId: projects[0].id,
  tags: [tags[0]],
  dueDate: today,
  priority: 2,
});
fixture("Book a table for Friday", {
  projectId: projects[2].id,
  assignees: users,
  dueDate: today,
  priority: 1,
  tags: [tags[2]],
});
fixture("Send over the inspiration board", {
  createdBy: users[1],
  projectId: projects[0].id,
  dueDate: yesterday,
  tags: [tags[0]],
});
fixture("Pick up something green for the desk", {
  projectId: projects[1].id,
  tags: [tags[1]],
});
fixture("Take a proper lunch break", { assignees: users, tags: [tags[2]] });
fixture("A few thoughts for our next little project", {
  createdBy: users[1],
  projectId: projects[0].id,
  tags: [tags[0]],
  notes: "No rush. Just collecting the ideas we don’t want to forget.",
});
fixture("Find a new Sunday walking route", {
  projectId: projects[2].id,
  dueDate: tomorrow,
});
fixture("Look into that little coffee place", {
  assignees: [users[1]],
  projectId: projects[2].id,
});
fixture("Share the first round of sketches", {
  assignees: [users[1]],
  projectId: projects[0].id,
  priority: 2,
});
fixture("A weekend somewhere by the sea", {
  list: "later",
  projectId: projects[2].id,
  tags: [tags[0]],
  assignees: users,
});
fixture("Try a softer color palette", {
  list: "later",
  projectId: projects[0].id,
});
fixture("A place for all our favorite recipes", {
  list: "later",
  projectId: projects[1].id,
  tags: [tags[0]],
});
fixture("Something lovely we haven’t thought of yet", { assignees: [] });
fixture("Set up our shared little space", {
  done: true,
  doneAt: stamp(),
  assignees: users,
  projectId: projects[0].id,
});
fixture("Put a date in the calendar", {
  done: true,
  doneAt: new Date(Date.now() - 86400000).toISOString(),
  projectId: projects[2].id,
});
const tokens = [];
const resolveUser = (identifier, me) =>
  identifier === "me"
    ? me
    : identifier === "teammate"
      ? users.find((u) => u.id !== me.id)
      : users.find((u) =>
          [u.id, u.username, u.displayName].some(
            (v) => v.toLowerCase() === String(identifier).toLowerCase(),
          ),
        );
function resolveTag(identifier) {
  let tag = tags.find(
    (t) =>
      t.id === identifier ||
      t.name.toLowerCase() === String(identifier).toLowerCase(),
  );
  if (!tag) {
    tag = { id: randomUUID(), name: String(identifier), color: "gray" };
    tags.push(tag);
  }
  return tag;
}
const shape = (t) => {
  const result = { ...t, project: projects.find((p) => p.id === t.projectId) || null };
  delete result.laterSince;
  return result;
};
function filterTasks(params, me) {
  const view = params.get("view") || "all";
  const other = users.find((u) => u.id !== me.id);
  let result = tasks.filter((t) => {
    const done =
      params.get("done") || (view === "completed" ? "true" : "false");
    if (done !== "all" && t.done !== (done === "true")) return false;
    if (
      view.startsWith("mine") &&
      (t.list !== "now" || !t.assignees.some((a) => a.id === me.id))
    )
      return false;
    if (view === "mine_created" && t.createdBy.id !== me.id) return false;
    if (view === "mine_from_teammate" && t.createdBy.id !== other.id)
      return false;
    if (
      view === "teammate" &&
      (t.list !== "now" || !t.assignees.some((a) => a.id === other.id))
    )
      return false;
    if (view === "later" && t.list !== "later") return false;
    if (view === "unassigned" && (t.list !== "now" || t.assignees.length))
      return false;
    if (
      params.has("assignee") &&
      !t.assignees.some(
        (a) => a.id === resolveUser(params.get("assignee"), me)?.id,
      )
    )
      return false;
    if (
      params.has("createdBy") &&
      t.createdBy.id !== resolveUser(params.get("createdBy"), me)?.id
    )
      return false;
    if (params.has("list") && t.list !== params.get("list")) return false;
    if (params.has("projectId") && t.projectId !== params.get("projectId"))
      return false;
    if (
      params.has("tag") &&
      !t.tags.some(
        (tag) =>
          tag.id === params.get("tag") ||
          tag.name.toLowerCase() === params.get("tag").toLowerCase(),
      )
    )
      return false;
    if (
      params.has("q") &&
      !`${t.title} ${t.notes}`
        .toLowerCase()
        .includes(params.get("q").toLowerCase())
    )
      return false;
    return true;
  });
  result.sort((a, b) =>
    view === "completed"
      ? String(b.doneAt).localeCompare(String(a.doneAt))
      : b.position - a.position,
  );
  return result.slice(0, Math.min(Number(params.get("limit") || 200), 1000));
}
function patch(task, body, me) {
  const previousList = task.list;
  for (const field of [
    "title",
    "notes",
    "list",
    "dueDate",
    "priority",
    "projectId",
    "position",
  ])
    if (body[field] !== undefined) task[field] = body[field];
  if (body.done !== undefined && body.done !== task.done) {
    task.done = body.done;
    task.doneAt = body.done ? stamp() : null;
  }
  if (body.assignees)
    task.assignees = [
      ...new Map(
        body.assignees
          .map((v) => resolveUser(v, me))
          .filter(Boolean)
          .map((u) => [u.id, u]),
      ).values(),
    ];
  if (body.tags)
    task.tags = [
      ...new Map(body.tags.map(resolveTag).map((t) => [t.id, t])).values(),
    ];
  if (body.addAssignees)
    task.assignees = [
      ...new Map(
        [
          ...task.assignees,
          ...body.addAssignees.map((v) => resolveUser(v, me)).filter(Boolean),
        ].map((u) => [u.id, u]),
      ).values(),
    ];
  if (body.removeAssignees)
    task.assignees = task.assignees.filter(
      (u) => !body.removeAssignees.some((v) => resolveUser(v, me)?.id === u.id),
    );
  if (body.list === "later") task.assignees = [];
  else if (body.assignees?.length || body.addAssignees?.length)
    task.list = "now";
  if (body.addTags)
    task.tags = [
      ...new Map(
        [...task.tags, ...body.addTags.map(resolveTag)].map((t) => [t.id, t]),
      ).values(),
    ];
  if (body.removeTags)
    task.tags = task.tags.filter(
      (t) =>
        !body.removeTags.some(
          (v) => v === t.id || String(v).toLowerCase() === t.name.toLowerCase(),
        ),
    );
  if (previousList === "later" && task.list === "now" && body.dueDate === undefined && (!task.dueDate || task.dueDate < localDate(new Date())))
    task.dueDate = defaultDate();
  if (task.list !== "later") task.laterSince = null;
  else if (previousList !== "later") task.laterSince = stamp();
  task.updatedAt = stamp();
}
// Match the production worker without requiring requests to trigger reviews.
setInterval(() => {
  for (const task of tasks) {
    if (task.list !== "later" || task.done || Date.parse(task.laterSince) > Date.now() - 14 * 86400000) continue;
    task.resurfacedAt = stamp();
    patch(task, { assignees: [users[randomInt(2)].id], position: Date.now() }, users[0]);
  }
}, 60000).unref();
async function body(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 100 * 1024 * 1024)
      throw Object.assign(new Error("request_too_large"), { status: 413 });
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  if (req.headers["content-type"]?.includes("multipart/form-data")) {
    const form = await new Request(`http://localhost:${port}`, {
      method: "POST",
      headers: { "Content-Type": req.headers["content-type"] },
      body: bytes,
    }).formData();
    const data = {};
    const uploads = [];
    for (const [key, value] of form.entries()) {
      if (key === "files" && typeof value !== "string") {
        if (
          !/^image\/(png|jpeg|gif|webp|heic|heif)$/.test(value.type) ||
          value.size > 20 * 1024 * 1024
        )
          throw Object.assign(new Error("invalid_image"), { status: 400 });
        uploads.push(value);
      } else if (typeof value === "string") {
        let parsed;
        try {
          parsed = JSON.parse(value);
        } catch {
          parsed = value;
        }
        if (key === "assignees" || key === "tags")
          data[key] = [
            ...(data[key] || []),
            ...(Array.isArray(parsed) ? parsed : [parsed]),
          ];
        else data[key] = parsed;
      }
    }
    return { data, uploads };
  }
  return {
    data: bytes.length ? JSON.parse(bytes.toString()) : {},
    uploads: [],
  };
}
async function attach(task, uploads) {
  for (const f of uploads) {
    const id = randomUUID();
    files.set(id, {
      bytes: Buffer.from(await f.arrayBuffer()),
      mimeType: f.type,
    });
    task.attachments.push({
      id,
      taskId: task.id,
      filename: f.name,
      mimeType: f.type,
      size: f.size,
      url: `/api/attachments/${id}/file`,
      createdAt: stamp(),
    });
  }
}
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const parts = url.pathname.split("/").filter(Boolean);
  const method = req.method;
  const send = (data, status = 200) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  };
  try {
    if (url.pathname === "/api/health") return send({ ok: true });
    if (url.pathname === "/api/agent" || url.pathname === "/agent") {
      res.writeHead(200, { "Content-Type": "text/markdown" });
      return res.end(
        `# todoer development mock\n\nShared tasks for two. Use Settings → Agent tokens. Authenticate with Authorization: Bearer <token>. Base URL: http://${req.headers.host}\n\nThis is an in-memory development mock. See SPEC.md for the full contract.\n`,
      );
    }
    if (url.pathname === "/api/auth/login" && method === "POST") {
      const { data } = await body(req);
      const u = users.find(
        (u) =>
          [u.username, emails.get(u.id)].some(
            (value) =>
              value &&
              value.toLowerCase() === String(data.username).trim().toLowerCase(),
          ),
      );
      if (!u || passwords.get(u.id) !== data.password)
        return send({ error: "invalid_credentials" }, 401);
      const session = randomUUID();
      sessions.set(session, u.id);
      res.setHeader(
        "Set-Cookie",
        `todoer_session=${session}; HttpOnly; SameSite=Lax; Path=/; Max-Age=7776000`,
      );
      return send({ user: u });
    }
    const session = req.headers.cookie
      ?.split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith("todoer_session="))
      ?.split("=")[1];
    const userId =
      sessions.get(session) ||
      tokenSecrets.get(req.headers.authorization?.replace(/^Bearer /, ""));
    const me = users.find((u) => u.id === userId);
    if (!me) return send({ error: "unauthorized" }, 401);
    if (url.pathname === "/api/auth/logout") {
      sessions.delete(session);
      res.setHeader(
        "Set-Cookie",
        "todoer_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
      );
      return send({ ok: true });
    }
    if (parts[1] === "me") {
      if (method === "PATCH") {
        const { data } = await body(req);
        if (data.password && passwords.get(me.id) !== data.currentPassword)
          return send({ error: "incorrect_current_password" }, 400);
        let githubLogin;
        if (data.githubLogin !== undefined) {
          if (data.githubLogin !== null && typeof data.githubLogin !== "string") return send({ error: "Enter a valid GitHub username" }, 400);
          githubLogin = data.githubLogin?.trim() || null;
          if (githubLogin && !/^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/.test(githubLogin)) return send({ error: "Enter a valid GitHub username" }, 400);
          if (githubLogin && users.some((u) => u.id !== me.id && githubLogins.get(u.id)?.toLowerCase() === githubLogin.toLowerCase())) return send({ error: "That GitHub username is already linked" }, 409);
        }
        let email;
        if (data.email !== undefined) {
          if (data.email !== null && typeof data.email !== "string")
            return send({ error: "Enter a valid email address" }, 400);
          email = data.email?.trim() || null;
          if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
            return send({ error: "Enter a valid email address" }, 400);
          if (
            email &&
            users.some(
              (u) => u.id !== me.id &&
                emails.get(u.id)?.toLowerCase() === email.toLowerCase(),
            )
          )
            return send({ error: "That email is already in use" }, 409);
        }
        if (
          data.emailNotifications !== undefined &&
          typeof data.emailNotifications !== "boolean"
        )
          return send({ error: "emailNotifications must be a boolean" }, 400);
        if (data.activeProjectId !== undefined) {
          if (
            data.activeProjectId !== null &&
            !projects.some((p) => p.id === data.activeProjectId)
          )
            return send({ error: "unknown_project" }, 400);
          activeProjects.set(me.id, data.activeProjectId);
        }
        if (data.githubLogin !== undefined) githubLogins.set(me.id, githubLogin);
        if (data.email !== undefined) emails.set(me.id, email);
        if (data.emailNotifications !== undefined)
          emailNotifications.set(me.id, data.emailNotifications);
        if (data.displayName) me.displayName = data.displayName;
        if (data.password) passwords.set(me.id, data.password);
        return send({ user: currentUser(me) });
      }
      return send({
        user: currentUser(me),
        teammate: users.find((u) => u.id !== me.id),
      });
    }
    if (parts[1] === "users") return send({ users });
    if (parts[1] === "score" && method === "GET") {
      const now = Date.now();
      const own = scoreEntry(tasks, me, now, githubLogins.get(me.id));
      const otherUser = users.find((u) => u.id !== me.id);
      const other = otherUser ? scoreEntry(tasks, otherUser, now, githubLogins.get(otherUser.id)) : null;
      const difference = other ? own.score - other.score : 0;
      return send({ me: own, teammate: other, leader: difference > 0 ? "me" : difference < 0 ? "teammate" : null, lead: Math.abs(difference) });
    }
    if (parts[1] === "counts") {
      const count = (view) =>
        filterTasks(
          new URLSearchParams({
            ...Object.fromEntries(url.searchParams),
            view,
            limit: "1000",
          }),
          me,
        ).length;
      return send({
        mine: count("mine"),
        mineCreated: count("mine_created"),
        mineFromTeammate: count("mine_from_teammate"),
        teammate: count("teammate"),
        later: count("later"),
        unassigned: count("unassigned"),
        completed: count("completed"),
      });
    }
    if (parts[1] === "tokens") {
      if (method === "GET")
        return send({
          tokens: tokens
            .filter((t) => t.userId === me.id)
            .map((t) => ({
              id: t.id,
              name: t.name,
              createdAt: t.createdAt,
              lastUsedAt: t.lastUsedAt,
            })),
        });
      if (method === "POST") {
        const { data } = await body(req);
        const token = {
          id: randomUUID(),
          userId: me.id,
          name: data.name || "Personal token",
          createdAt: stamp(),
          lastUsedAt: null,
        };
        const secret = `tdr_${randomBytes(24).toString("hex")}`;
        tokens.push(token);
        tokenSecrets.set(secret, me.id);
        tokenSecrets.set(token.id, secret);
        return send(
          {
            token: {
              id: token.id,
              name: token.name,
              createdAt: token.createdAt,
            },
            secret,
          },
          201,
        );
      }
      if (method === "DELETE") {
        const index = tokens.findIndex(
          (t) => t.id === parts[2] && t.userId === me.id,
        );
        if (index < 0) return send({ error: "not_found" }, 404);
        tokenSecrets.delete(tokenSecrets.get(parts[2]));
        tokenSecrets.delete(parts[2]);
        tokens.splice(index, 1);
        return send({ ok: true });
      }
    }
    if (parts[1] === "tasks") {
      if (!parts[2]) {
        if (method === "GET")
          return send({ tasks: filterTasks(url.searchParams, me).map(shape) });
        if (method === "POST") {
          const { data, uploads } = await body(req);
          if (data.projectId && !projects.some((p) => p.id === data.projectId))
            return send({ error: "unknown_project" }, 400);
          const task = fixture("", {
            assignees: [me],
            createdBy: me,
            createdAt: stamp(),
            position: Date.now(),
          });
          patch(task, { ...data, addAssignees: undefined }, me);
          if (task.list === "now" && data.dueDate === undefined) task.dueDate = defaultDate();
          await attach(task, uploads);
          return send({ task: shape(task) }, 201);
        }
      }
      const task = tasks.find((t) => t.id === parts[2]);
      if (!task) return send({ error: "not_found" }, 404);
      if (parts[3] === "handoff" && method === "POST") {
        const { data } = await body(req);
        const to = resolveUser(data.to || "teammate", me);
        if (!to) return send({ error: "invalid_user" }, 400);
        patch(task, { assignees: [to.id] }, me);
        return send({ task: shape(task) });
      }
      if (parts[3] === "attachments" && method === "POST") {
        const { uploads } = await body(req);
        await attach(task, uploads);
        return send({ task: shape(task) });
      }
      if (method === "GET") return send({ task: shape(task) });
      if (method === "PATCH") {
        const { data } = await body(req);
        if (data.projectId && !projects.some((p) => p.id === data.projectId))
          return send({ error: "unknown_project" }, 400);
        const completing = data.done === true && !task.done;
        const now = Date.now();
        const before = completing ? scoreEntry(tasks, me, now).score : null;
        patch(task, data, me);
        const after = completing ? scoreEntry(tasks, me, Math.max(now, Date.parse(task.doneAt))).score : null;
        return send({ task: shape(task), ...(completing ? { scoreChange: { before, after, delta: after - before } } : {}) });
      }
      if (method === "DELETE") {
        task.attachments.forEach((a) => files.delete(a.id));
        tasks.splice(tasks.indexOf(task), 1);
        return send({ ok: true });
      }
    }
    if (parts[1] === "attachments") {
      const file = files.get(parts[2]);
      if (!file) return send({ error: "not_found" }, 404);
      if (method === "DELETE") {
        files.delete(parts[2]);
        tasks.forEach((t) => {
          t.attachments = t.attachments.filter((a) => a.id !== parts[2]);
        });
        return send({ ok: true });
      }
      if (method === "GET" && parts[3] === "file") {
        res.writeHead(200, {
          "Content-Type": file.mimeType,
          "Cache-Control": "private, max-age=31536000",
        });
        return res.end(file.bytes);
      }
    }
    if (parts[1] === "projects" || parts[1] === "tags") {
      const isProject = parts[1] === "projects";
      const collection = isProject ? projects : tags;
      if (!parts[2] && method === "GET")
        return send({
          [parts[1]]: collection.map((item) => ({
            ...item,
            [isProject ? "openCount" : "count"]: tasks.filter(
              (t) =>
                !t.done &&
                (isProject
                  ? t.projectId === item.id
                  : t.tags.some((tag) => tag.id === item.id) &&
                    (!url.searchParams.has("projectId") ||
                      t.projectId === url.searchParams.get("projectId"))),
            ).length,
          })),
        });
      if (!parts[2] && method === "POST") {
        const { data } = await body(req);
        if (!isProject) {
          const existing = tags.find(
            (t) => t.name.toLowerCase() === String(data.name).toLowerCase(),
          );
          if (existing) return send({ tag: existing });
        }
        const item = {
          id: randomUUID(),
          name: data.name || (isProject ? "New Project" : ""),
          color: data.color || "blue",
          ...(isProject
            ? {
                emoji: data.emoji || null,
                githubRepo: normalizeGithubRepo(data.githubRepo),
                position: Date.now(),
                createdAt: stamp(),
              }
            : {}),
        };
        collection.push(item);
        return send({ [isProject ? "project" : "tag"]: item }, 201);
      }
      const item = collection.find((i) => i.id === parts[2]);
      if (!item) return send({ error: "not_found" }, 404);
      if (method === "PATCH") {
        const { data } = await body(req);
        if (isProject && data.githubRepo !== undefined) item.githubRepo = normalizeGithubRepo(data.githubRepo);
        for (const key of [
          "name",
          "color",
          ...(isProject ? ["emoji", "position"] : []),
        ])
          if (data[key] !== undefined) item[key] = data[key];
        return send({ [isProject ? "project" : "tag"]: item });
      }
      if (method === "DELETE") {
        collection.splice(collection.indexOf(item), 1);
        if (isProject)
          for (const [id, projectId] of activeProjects)
            if (projectId === item.id) activeProjects.set(id, null);
        tasks.forEach((t) => {
          if (isProject && t.projectId === item.id) t.projectId = null;
          if (!isProject) t.tags = t.tags.filter((tag) => tag.id !== item.id);
        });
        return send({ ok: true });
      }
    }
    send({ error: "not_found" }, 404);
  } catch (error) {
    console.error(error);
    if (!res.headersSent)
      send({ error: error.message || "server_error" }, error.status || 500);
  }
});
server.listen(port, "127.0.0.1", () =>
  console.log(
    `\nDevelopment-only todoer mock: http://localhost:${port}\nSign in: maxim / todoer or teammate / todoer\nEverything resets when this process stops.\n`,
  ),
);

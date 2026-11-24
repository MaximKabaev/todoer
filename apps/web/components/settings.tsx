"use client";
import { useState } from "react";
import styles from "./settings.module.css";
import useSWR, { useSWRConfig } from "swr";
import {
  ArrowUpRight,
  Check,
  Copy,
  Github,
  KeyRound,
  LogOut,
  Plus,
  Terminal,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { api, type AgentToken, type CurrentUser, type EmailPreferences, type Project } from "@/lib/api";
import { Avatar, Confirm, Modal } from "./ui";
import { useToast } from "./providers";

const emailPreferenceOptions: {
  key: keyof EmailPreferences;
  label: string;
  description: string;
}[] = [
  {
    key: "assigned",
    label: "Assigned to you",
    description: "Your teammate assigns you a task, a task returns from Later for review, or you take one from Later.",
  },
  {
    key: "completed",
    label: "Completed tasks",
    description: "Your teammate completes or reopens a task involving you. Includes good boy score.",
  },
  {
    key: "updates",
    label: "Other task changes",
    description: "New tasks, edits, due dates, priorities, tags, images, moves, unassignments, and deletions.",
  },
  {
    key: "achievements",
    label: "Achievements",
    description: "Either of you unlocks a badge.",
  },
  {
    key: "afk",
    label: "AFK penalties",
    description: "Daily inactivity penalties.",
  },
  {
    key: "seasons",
    label: "Season results",
    description: "The monthly season winner and scores.",
  },
];

export function Settings({
  user,
  onClose,
}: {
  user: CurrentUser;
  onClose: () => void;
}) {
  const { data, mutate: refresh } = useSWR<{ tokens: AgentToken[] }>(
    "/api/tokens",
  );
  const { data: projectData } = useSWR<{ projects: Project[] }>("/api/projects");
  const projectName = (id: string | null) =>
    projectData?.projects.find((p) => p.id === id)?.name || "one project";
  const { mutate, cache } = useSWRConfig();
  const router = useRouter();
  const toast = useToast();
  const [github, setGithub] = useState(user.githubLogin || "");
  const [savedGithub, setSavedGithub] = useState(user.githubLogin || "");
  const [githubBusy, setGithubBusy] = useState(false);
  const [githubError, setGithubError] = useState("");
  async function saveGithub(value: string) {
    setGithubBusy(true);
    setGithubError("");
    try {
      const { user: updated } = await api.updateMe({ githubLogin: value.trim() || null });
      setGithub(updated.githubLogin || "");
      setSavedGithub(updated.githubLogin || "");
      await Promise.all([mutate("/api/me"), mutate("/api/score")]);
      toast({ message: updated.githubLogin ? "GitHub connected." : "GitHub disconnected." });
    } catch (err) {
      setGithubError(err instanceof Error ? err.message : "Could not update GitHub.");
    } finally {
      setGithubBusy(false);
    }
  }
  const [birthdayMonth, setBirthdayMonth] = useState(user.birthday?.slice(0, 2) || "");
  const [birthdayDay, setBirthdayDay] = useState(user.birthday?.slice(3) || "");
  const birthdayDays = birthdayMonth ? new Date(Date.UTC(2024, Number(birthdayMonth), 0)).getUTCDate() : 31;
  const [name, setName] = useState(user.displayName);
  const [email, setEmail] = useState(user.email || "");
  const [savedEmail, setSavedEmail] = useState(user.email || "");
  const [notifications, setNotifications] = useState(
    user.emailNotifications ?? false,
  );
  const [emailPreferences, setEmailPreferences] = useState(user.emailPreferences);
  const emailPreferencesDisabled = !savedEmail || !notifications;
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [tokenName, setTokenName] = useState("");
  const [tokenProject, setTokenProject] = useState("");
  const [revoke, setRevoke] = useState<AgentToken | null>(null);
  const [copied, setCopied] = useState("");
  const agentUrl = `${window.location.origin}/agent`;
  async function copy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(""), 2000);
    } catch {
      toast({
        message: "Could not copy. Select and copy the text manually.",
        error: true,
      });
    }
  }
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formElement = e.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    try {
      await api.updateMe({
        displayName: name.trim() || user.displayName,
        birthday: birthdayMonth && birthdayDay ? `${birthdayMonth}-${birthdayDay}` : null,
        ...(form.get("password")
          ? {
              password: String(form.get("password")),
              currentPassword: String(form.get("currentPassword")),
            }
          : {}),
      });
      await mutate("/api/me");
      formElement.reset();
      toast({ message: "Your account is up to date." });
    } catch (err) {
      toast({
        message:
          err instanceof Error ? err.message : "Could not update account.",
        error: true,
      });
    } finally {
      setBusy(false);
    }
  }
  async function saveEmail(input: Pick<
    Parameters<typeof api.updateMe>[0],
    "email" | "emailNotifications" | "emailPreferences"
  >) {
    if (emailBusy) return;
    const previousNotifications = notifications;
    const previousPreferences = emailPreferences;
    if (input.emailNotifications !== undefined)
      setNotifications(input.emailNotifications);
    if (input.emailPreferences)
      setEmailPreferences({ ...emailPreferences, ...input.emailPreferences });
    setEmailBusy(true);
    setEmailError("");
    try {
      const { user: updated } = await api.updateMe(input);
      setSavedEmail(updated.email || "");
      if (input.email !== undefined) setEmail(updated.email || "");
      setNotifications(updated.emailNotifications ?? false);
      setEmailPreferences(updated.emailPreferences);
      await mutate("/api/me");
      toast({ message: "Your email preferences are up to date." });
    } catch (err) {
      if (input.emailNotifications !== undefined)
        setNotifications(previousNotifications);
      if (input.emailPreferences) setEmailPreferences(previousPreferences);
      setEmailError(
        err instanceof Error ? err.message : "Could not update email preferences.",
      );
    } finally {
      setEmailBusy(false);
    }
  }
  return (
    <Modal
      title="Your little space"
      onClose={onClose}
      className="settings-modal"
    >
      <div className="settings-profile">
        <Avatar user={user} />
        <div>
          <strong>{user.displayName}</strong>
          <span>@{user.username}</span>
        </div>
        <span className="account-badge">Personal account</span>
      </div>
      <form className="settings-form" onSubmit={save}>
        <label>
          Display name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="nickname"
          />
        </label>
        <fieldset className={styles.birthday}>
          <legend>Birthday</legend>
          <p id="birthday-help" className="small muted">Optional. Only you can see this.</p>
          <div className={styles.birthdayFields}>
            <label>
              Month
              <select aria-label="Month" aria-describedby="birthday-help" value={birthdayMonth} onChange={(e) => {
                const month = e.target.value;
                setBirthdayMonth(month);
                if (!month || Number(birthdayDay) > new Date(Date.UTC(2024, Number(month), 0)).getUTCDate()) setBirthdayDay("");
              }}>
                <option value="">Month</option>
                {Array.from({ length: 12 }, (_, i) => <option key={i} value={String(i + 1).padStart(2, "0")}>{new Date(Date.UTC(2024, i, 1)).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" })}</option>)}
              </select>
            </label>
            <label>
              Day
              <select aria-label="Day" aria-describedby="birthday-help" value={birthdayDay} disabled={!birthdayMonth} required={!!birthdayMonth} onChange={(e) => setBirthdayDay(e.target.value)}>
                <option value="">Day</option>
                {Array.from({ length: birthdayDays }, (_, i) => <option key={i} value={String(i + 1).padStart(2, "0")}>{i + 1}</option>)}
              </select>
            </label>
          </div>
          <button type="button" className="text-button" onClick={() => { setBirthdayMonth(""); setBirthdayDay(""); }}>Clear birthday</button>
        </fieldset>
        <details>
          <summary>
            <KeyRound size={16} /> Change password <ArrowUpRight size={14} />
          </summary>
          <label>
            Current password
            <input
              name="currentPassword"
              type="password"
              autoComplete="current-password"
            />
          </label>
          <label>
            New password
            <input
              name="password"
              type="password"
              autoComplete="new-password"
            />
          </label>
        </details>
        <button className="secondary-button" disabled={busy}>
          {busy ? "Saving…" : "Save changes"}
        </button>
      </form>
      <div className="settings-divider" />
      <section className="github-section" aria-labelledby="github-heading">
        <div className="settings-section-title">
          <span className="agent-icon"><Github size={19} aria-hidden="true" /></span>
          <div>
            <h3 id="github-heading">GitHub</h3>
            <p id="github-help">Commits and merged PRs on any branch of connected repos count as activity for the daily AFK check.</p>
          </div>
        </div>
        <form className="settings-form" onSubmit={(e) => { e.preventDefault(); void saveGithub(github); }}>
          <label>
            GitHub username
            <input value={github} onChange={(e) => { setGithub(e.target.value); setGithubError(""); }} placeholder="your-github-username" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="off" aria-describedby={githubError ? "github-help github-error" : "github-help"} aria-invalid={!!githubError} disabled={githubBusy} />
          </label>
          <div className="github-actions">
            <button className="secondary-button" disabled={githubBusy || github.trim() === savedGithub}>{githubBusy ? "Saving…" : "Save GitHub"}</button>
            {savedGithub && <button type="button" className="text-button" disabled={githubBusy} onClick={() => void saveGithub("")}>Clear GitHub</button>}
            {savedGithub && <span className="small muted"><Check size={13} aria-hidden="true" /> Connected as @{savedGithub}</span>}
          </div>
          {githubError && <p className="form-error" id="github-error" role="alert">{githubError}</p>}
        </form>
      </section>
      <div className="settings-divider" />
      <section className="email-section" aria-labelledby="email-heading">
        <div className="settings-section-title">
          <div>
            <h3 id="email-heading">Email</h3>
            <p id="email-help">
              Batched every few minutes. You can also log in with this email.
            </p>
          </div>
        </div>
        <form
          className="settings-form"
          onSubmit={(e) => {
            e.preventDefault();
            void saveEmail({ email: email.trim() });
          }}
        >
          <label>
            Email address
            <input
              type="email"
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect="off"
              aria-describedby="email-help"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <button className="secondary-button" disabled={emailBusy}>
            {emailBusy ? "Saving…" : "Save email"}
          </button>
        </form>
        <label
          className={`email-notifications ${!savedEmail ? "is-disabled" : ""}`}
        >
          <span>Email notifications</span>
          <input
            type="checkbox"
            role="switch"
            checked={notifications}
            disabled={!savedEmail || emailBusy}
            aria-describedby={!savedEmail ? "email-notifications-hint" : undefined}
            onChange={(e) =>
              void saveEmail({ emailNotifications: e.target.checked })
            }
          />
        </label>
        {!savedEmail && (
          <p className="small muted" id="email-notifications-hint">
            Save an email address to receive notifications.
          </p>
        )}
        <div className="email-preferences" role="group" aria-label="Email alert types">
          {emailPreferenceOptions.map(({ key, label, description }) => (
            <label
              className={`email-notifications ${emailPreferencesDisabled ? "is-disabled" : ""}`}
              key={key}
            >
              <span>
                <span id={`email-preference-${key}`}>{label}</span>
                <span className="email-preference-description" id={`email-preference-${key}-help`}>
                  {description}
                </span>
              </span>
              <input
                type="checkbox"
                role="switch"
                checked={emailPreferences[key]}
                disabled={emailPreferencesDisabled || emailBusy}
                aria-labelledby={`email-preference-${key}`}
                aria-describedby={`email-preference-${key}-help`}
                onChange={(e) =>
                  void saveEmail({ emailPreferences: { [key]: e.target.checked } })
                }
              />
            </label>
          ))}
        </div>
        {emailError && (
          <p className="form-error" role="alert">{emailError}</p>
        )}
      </section>
      <div className="settings-divider" />
      <section className="agent-section">
        <div className="settings-section-title">
          <span className="agent-icon">
            <Terminal size={19} />
          </span>
          <div>
            <h3>A little help from your agent</h3>
            <p>Let your AI take a few things off your list.</p>
          </div>
        </div>
        <label className="field-label">POINT YOUR AI AGENT HERE</label>
        <div className="copy-field">
          <a href="/agent" target="_blank" rel="noreferrer">
            {agentUrl}
          </a>
          <button
            className="icon-button"
            aria-label="Copy agent URL"
            onClick={() => void copy(agentUrl, "url")}
          >
            {copied === "url" ? <Check size={16} /> : <Copy size={16} />}
          </button>
        </div>
        {process.env.NEXT_PUBLIC_API_PUBLIC_URL && (
          <p className="public-api small muted">
            Direct API:{" "}
            <a href={process.env.NEXT_PUBLIC_API_PUBLIC_URL}>
              {process.env.NEXT_PUBLIC_API_PUBLIC_URL}
            </a>
          </p>
        )}
        <p className="small muted">
          Give it this link and a personal token below. Your agent can see and
          edit your shared tasks as you. A create-only token can just add tasks
          to one project.
        </p>
        <h4>Agent tokens</h4>
        {data?.tokens.map((t) => (
          <div className="token-row" key={t.id}>
            <KeyRound size={16} />
            <span>
              <strong>{t.name || "Personal token"}</strong>
              <small>
                {t.scope === "create" &&
                  `Create-only in ${projectName(t.projectId)} · `}
                Created {new Date(t.createdAt).toLocaleDateString()}
                {t.lastUsedAt
                  ? ` · Last used ${new Date(t.lastUsedAt).toLocaleDateString()}`
                  : " · Not used yet"}
              </small>
            </span>
            <button
              className="icon-button text-danger"
              aria-label={`Revoke ${t.name}`}
              onClick={() => setRevoke(t)}
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
        {data?.tokens.length === 0 && (
          <p className="muted small">
            No tokens yet. Create one for your first agent.
          </p>
        )}
        {!data && <p className="muted small">Loading tokens…</p>}
        {secret && (
          <div className="secret-card" role="status">
            <strong>Your new token</strong>
            <p>Copy it now. You’ll only see it once.</p>
            <div className="copy-field">
              <code>{secret}</code>
              <button
                className="icon-button"
                aria-label="Copy new token"
                onClick={() => void copy(secret, "secret")}
              >
                {copied === "secret" ? <Check size={16} /> : <Copy size={16} />}
              </button>
            </div>
            <button className="text-button" onClick={() => setSecret(null)}>
              I’ve saved it
            </button>
          </div>
        )}
        <form
          className="token-form"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              const result = await api.createToken(
                tokenName || undefined,
                tokenProject || undefined,
              );
              setSecret(result.secret);
              setTokenName("");
              setTokenProject("");
              await refresh();
            } catch (err) {
              toast({
                message:
                  err instanceof Error
                    ? err.message
                    : "Could not create token.",
                error: true,
              });
            }
          }}
        >
          <input
            aria-label="Token name"
            placeholder="Token name, e.g. My assistant"
            value={tokenName}
            onChange={(e) => setTokenName(e.target.value)}
          />
          <select
            aria-label="Token access"
            value={tokenProject}
            onChange={(e) => setTokenProject(e.target.value)}
          >
            <option value="">Full access</option>
            {projectData?.projects.map((p) => (
              <option key={p.id} value={p.id}>
                Create-only in {p.name || "Untitled project"}
              </option>
            ))}
          </select>
          <button className="secondary-button">
            <Plus size={15} /> Create
          </button>
        </form>
      </section>
      <button
        className="logout-button"
        onClick={async () => {
          try {
            await api.logout();
            for (const key of cache.keys()) cache.delete(key);
            router.replace("/login");
          } catch (err) {
            toast({
              message:
                err instanceof Error ? err.message : "Could not log out.",
              error: true,
            });
          }
        }}
      >
        <LogOut size={17} /> Sign out
      </button>
      {revoke && (
        <Confirm
          title="Revoke this token?"
          text={`Agents using “${revoke.name}” will lose access immediately.`}
          label="Revoke"
          onClose={() => setRevoke(null)}
          onConfirm={() => {
            api
              .revokeToken(revoke.id)
              .then(() => refresh())
              .catch((err) => toast({ message: err.message, error: true }));
          }}
        />
      )}
    </Modal>
  );
}

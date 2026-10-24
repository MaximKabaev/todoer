"use client";
import { useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import {
  ArrowUpRight,
  Check,
  Copy,
  KeyRound,
  LogOut,
  Plus,
  Terminal,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { api, type AgentToken, type User } from "@/lib/api";
import { Avatar, Confirm, Modal } from "./ui";
import { useToast } from "./providers";
export function Settings({
  user,
  onClose,
}: {
  user: User;
  onClose: () => void;
}) {
  const { data, mutate: refresh } = useSWR<{ tokens: AgentToken[] }>(
    "/api/tokens",
  );
  const { mutate, cache } = useSWRConfig();
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState(user.displayName);
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [tokenName, setTokenName] = useState("");
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
          edit your shared tasks as you.
        </p>
        <h4>Agent tokens</h4>
        {data?.tokens.map((t) => (
          <div className="token-row" key={t.id}>
            <KeyRound size={16} />
            <span>
              <strong>{t.name || "Personal token"}</strong>
              <small>
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
              const result = await api.createToken(tokenName || undefined);
              setSecret(result.secret);
              setTokenName("");
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

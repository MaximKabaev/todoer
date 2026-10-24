"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSWRConfig } from "swr";
import { ArrowRight, CheckCheck, LoaderCircle } from "lucide-react";
import { api } from "@/lib/api";
export default function LoginPage() {
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <main className="login-page">
      <div className="login-orb orb-one" />
      <div className="login-orb orb-two" />
      <section className="login-card">
        <div className="app-icon">
          <CheckCheck size={36} strokeWidth={2.8} />
        </div>
        <span className="eyebrow">A LITTLE MORE TOGETHER</span>
        <h1>Welcome to todoer.</h1>
        <p>
          Your things. Their things.
          <br />A little space to get them done, together.
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            setBusy(true);
            setError("");
            try {
              await api.login(
                String(form.get("username")),
                String(form.get("password")),
              );
              await mutate("/api/me", await api.me(), { revalidate: false });
              router.replace("/");
            } catch (err) {
              setError(
                err instanceof Error ? err.message : "Could not sign in.",
              );
              setBusy(false);
            }
          }}
        >
          <label htmlFor="username">Username</label>
          <input
            id="username"
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            required
            placeholder="Your username"
          />
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            placeholder="Your password"
          />
          {error && (
            <p className="form-error" role="alert">
              {error === "invalid_credentials"
                ? "That username or password doesn’t look right."
                : error}
            </p>
          )}
          <button className="primary-button" disabled={busy}>
            {busy ? (
              <LoaderCircle className="spin" size={18} />
            ) : (
              <>
                Sign in <ArrowRight size={18} />
              </>
            )}
          </button>
        </form>
        <div className="login-footnote">
          <span className="status-dot" /> Just the two of you. Always in sync.
        </div>
      </section>
      <span className="login-wordmark">
        todoer<span>.</span>
      </span>
    </main>
  );
}

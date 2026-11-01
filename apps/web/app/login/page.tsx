"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { safeNext } from "@/lib/routes";
import { Brand } from "@/components/ui";
import { useSWRConfig } from "swr";
import { ArrowRight, CheckCheck, LoaderCircle } from "lucide-react";
import { api } from "@/lib/api";
export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="auth-loading">
          <Brand />
        </div>
      }
    >
      <Login />
    </Suspense>
  );
}
function Login() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const { data, error: authError } = useSWR("/api/me");
  useEffect(() => {
    if (data) router.replace(next);
  }, [data, router, next]);
  const { mutate } = useSWRConfig();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!authError || data)
    return (
      <div className="auth-loading">
        <Brand />
      </div>
    );
  return (
    <main className="login-page">
      <title>Sign in · todoer</title>
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
              router.replace(next);
            } catch (err) {
              setError(
                err instanceof Error ? err.message : "Could not sign in.",
              );
              setBusy(false);
            }
          }}
        >
          <label htmlFor="username">Username or email</label>
          <input
            id="username"
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            required
            placeholder="Username or email"
            inputMode="email"
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
                ? "That username, email or password doesn’t look right."
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
      </section>
      <span className="login-wordmark">
        todoer<span>.</span>
      </span>
    </main>
  );
}

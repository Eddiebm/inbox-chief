"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { product } from "@/lib/product";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        next?: string;
      };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Could not sign in.");
        return;
      }
      router.push(data.next ?? "/dashboard");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={onSubmit} noValidate aria-labelledby="login-heading">
      <h1 id="login-heading">Sign in to {product.name}</h1>
      <p className="lede">
        Use your email and password. After you sign in, you can open the dashboard
        or connect Gmail.
      </p>
      {busy ? (
        <p className="status-line" role="status" aria-live="polite">
          Signing in…
        </p>
      ) : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <label htmlFor="login-email">
        Email
        <input
          id="login-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <label htmlFor="login-password">
        Password
        <input
          id="login-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <button
        type="submit"
        className="btn btn--primary btn--block"
        disabled={busy}
        aria-busy={busy}
      >
        {busy ? "Signing in…" : "Sign in"}
      </button>
      <p>
        <a href="/forgot-password">Forgot password?</a>
      </p>
      <p>
        New here? <a href="/signup">Create an account</a> then use{" "}
        <a href="/onboarding">voice onboarding</a>.
      </p>
    </form>
  );
}

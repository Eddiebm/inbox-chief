"use client";

import { useId, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";

type SignupStatus = "idle" | "submitting" | "error" | "success";

export function SignupForm() {
  const router = useRouter();
  const formId = useId();
  const [status, setStatus] = useState<SignupStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("submitting");
    setMessage(null);

    const form = event.currentTarget;
    const data = new FormData(form);

    try {
      const response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: String(data.get("name") ?? "").trim(),
          email: String(data.get("email") ?? "").trim(),
          password: String(data.get("password") ?? ""),
        }),
      });

      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        ok?: boolean;
        code?: string;
        next?: string;
      } | null;

      if (!response.ok) {
        setStatus("error");
        if (response.status === 409 || payload?.code === "account_exists") {
          setMessage(
            payload?.error ?? "An account with that email already exists. Sign in.",
          );
          return;
        }
        setMessage(payload?.error ?? "Signup failed. Please try again.");
        return;
      }

      setStatus("success");
      setMessage("Account created. Continuing to onboarding…");
      router.push("/onboarding");
    } catch {
      setStatus("error");
      setMessage("Network error. Check your connection and try again.");
    }
  }

  return (
    <form className="signup-form" onSubmit={onSubmit} noValidate>
      <div className="field">
        <label htmlFor={`${formId}-name`}>Full name</label>
        <input
          id={`${formId}-name`}
          name="name"
          type="text"
          autoComplete="name"
          required
          minLength={2}
          placeholder="Jordan Lee"
        />
      </div>

      <div className="field">
        <label htmlFor={`${formId}-email`}>Email</label>
        <input
          id={`${formId}-email`}
          name="email"
          type="email"
          autoComplete="email"
          required
          inputMode="email"
          placeholder="you@example.com"
        />
      </div>

      <div className="field">
        <label htmlFor={`${formId}-password`}>Password</label>
        <input
          id={`${formId}-password`}
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          placeholder="At least 10 characters"
        />
        <p className="field__hint">
          Use at least 10 characters. Stored securely when auth is enabled.
        </p>
      </div>

      <button
        type="submit"
        className="btn btn--primary btn--block"
        disabled={status === "submitting"}
      >
        {status === "submitting" ? "Creating account…" : "Create account"}
      </button>

      {status === "error" && message?.toLowerCase().includes("already exists") ? (
        <p className="form-error" role="alert" aria-live="assertive">
          {message}{" "}
          <a href="/login">Sign in</a>
        </p>
      ) : (
        <div
          className="form-status"
          role={status === "error" ? "alert" : "status"}
          aria-live={status === "error" ? "assertive" : "polite"}
          aria-atomic="true"
        >
          {message}
        </div>
      )}
    </form>
  );
}

"use client";

import { useId, useState } from "react";
import type { FormEvent } from "react";
import { FORGOT_PASSWORD_GENERIC } from "@/lib/auth/password-reset";
import { product } from "@/lib/product";

type Status = "idle" | "submitting" | "error" | "success";

export function ForgotPasswordForm() {
  const formId = useId();
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("submitting");
    setMessage(null);
    const form = event.currentTarget;
    const email = String(new FormData(form).get("email") ?? "").trim();

    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        message?: string;
      } | null;
      if (!response.ok) {
        setStatus("error");
        setMessage(payload?.error ?? "Could not start a password reset.");
        return;
      }
      setStatus("success");
      setMessage(payload?.message ?? FORGOT_PASSWORD_GENERIC);
    } catch {
      setStatus("error");
      setMessage("Network error. Check your connection and try again.");
    }
  }

  return (
    <form
      className="auth-form"
      onSubmit={onSubmit}
      noValidate
      aria-labelledby="forgot-heading"
    >
      <h1 id="forgot-heading">Forgot password</h1>
      <p className="lede">
        Enter the email for your {product.name} account. If an account exists,
        you can reset from the link we send. If you were set up by Inbox Chief,
        they can also set a temporary password.
      </p>
      {status === "submitting" ? (
        <p className="status-line" role="status" aria-live="polite">
          Sending reset instructions…
        </p>
      ) : null}
      {message ? (
        <p
          className={status === "error" ? "form-error" : "status-line"}
          role={status === "error" ? "alert" : "status"}
          aria-live={status === "error" ? "assertive" : "polite"}
        >
          {message}
        </p>
      ) : null}
      <label htmlFor={`${formId}-email`}>
        Email
        <input
          id={`${formId}-email`}
          name="email"
          type="email"
          autoComplete="email"
          required
          inputMode="email"
        />
      </label>
      <button
        type="submit"
        className="btn btn--primary btn--block"
        disabled={status === "submitting"}
        aria-busy={status === "submitting"}
      >
        {status === "submitting" ? "Sending…" : "Send reset instructions"}
      </button>
      <p>
        Remembered it? <a href="/login">Sign in</a>
      </p>
    </form>
  );
}

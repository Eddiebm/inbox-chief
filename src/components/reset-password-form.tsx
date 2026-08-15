"use client";

import { useId, useState } from "react";
import type { FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { product } from "@/lib/product";

type Status = "idle" | "submitting" | "error" | "success";

export function ResetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const formId = useId();
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(
    token ? null : "This reset link is missing. Request a new one from Forgot password.",
  );

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("submitting");
    setMessage(null);
    const form = event.currentTarget;
    const data = new FormData(form);
    const password = String(data.get("password") ?? "");
    const confirm = String(data.get("confirm") ?? "");
    if (password !== confirm) {
      setStatus("error");
      setMessage("Passwords do not match.");
      return;
    }

    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        message?: string;
        next?: string;
        ok?: boolean;
      } | null;
      if (!response.ok || !payload?.ok) {
        setStatus("error");
        setMessage(payload?.error ?? "Could not update password.");
        return;
      }
      setStatus("success");
      setMessage(payload.message ?? "Password updated. Sign in.");
      router.push(payload.next ?? "/login");
    } catch {
      setStatus("error");
      setMessage("Network error. Please try again.");
    }
  }

  return (
    <form
      className="auth-form"
      onSubmit={onSubmit}
      noValidate
      aria-labelledby="reset-heading"
    >
      <h1 id="reset-heading">Set a new password</h1>
      <p className="lede">
        Choose a new password for {product.name} (at least 10 characters). You
        will sign in after it saves.
      </p>
      {message ? (
        <p
          className={status === "error" || !token ? "form-error" : "status-line"}
          role={status === "error" || !token ? "alert" : "status"}
          aria-live={status === "error" || !token ? "assertive" : "polite"}
        >
          {message}
        </p>
      ) : null}
      <label htmlFor={`${formId}-password`}>
        New password
        <input
          id={`${formId}-password`}
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          disabled={!token}
        />
      </label>
      <label htmlFor={`${formId}-confirm`}>
        Confirm new password
        <input
          id={`${formId}-confirm`}
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          disabled={!token}
        />
      </label>
      <button
        type="submit"
        className="btn btn--primary btn--block"
        disabled={status === "submitting" || !token}
        aria-busy={status === "submitting"}
      >
        {status === "submitting" ? "Saving…" : "Save new password"}
      </button>
      <p>
        <a href="/forgot-password">Request a new reset link</a>
        {" · "}
        <a href="/login">Sign in</a>
      </p>
    </form>
  );
}

"use client";

import { useId, useState, type FormEvent } from "react";

type FormStatus =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

export function SupportForm() {
  const formId = useId();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<FormStatus>({ kind: "idle" });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setStatus({ kind: "submitting" });
    try {
      const res = await fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, subject, message }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        message?: string;
      };
      if (!res.ok || !data.ok) {
        setStatus({
          kind: "error",
          message: data.error ?? "Could not send support request.",
        });
        return;
      }
      setStatus({
        kind: "success",
        message:
          data.message ??
          "Support request received (stub). We will follow up when live support is connected.",
      });
      setSubject("");
      setMessage("");
    } catch {
      setStatus({
        kind: "error",
        message: "Network error. Please try again.",
      });
    }
  }

  return (
    <section className="dash-empty" aria-labelledby={`${formId}-heading`}>
      <h2 id={`${formId}-heading`} className="dash-empty__title">
        Contact support
      </h2>
      <form className="signup-form" onSubmit={onSubmit} noValidate>
        <div className="field">
          <label htmlFor={`${formId}-name`}>Name</label>
          <input
            id={`${formId}-name`}
            name="name"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor={`${formId}-email`}>Email</label>
          <input
            id={`${formId}-email`}
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor={`${formId}-subject`}>Subject</label>
          <input
            id={`${formId}-subject`}
            name="subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor={`${formId}-message`}>Message</label>
          <textarea
            id={`${formId}-message`}
            name="message"
            className="onboarding-textarea onboarding-input"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            required
            rows={5}
          />
        </div>
        <button
          type="submit"
          className="btn btn--primary"
          disabled={status.kind === "submitting"}
        >
          {status.kind === "submitting" ? "Sending…" : "Send request"}
        </button>
        <p className="form-status" role="status" aria-live="polite">
          {status.kind === "success" || status.kind === "error"
            ? status.message
            : ""}
        </p>
      </form>
    </section>
  );
}

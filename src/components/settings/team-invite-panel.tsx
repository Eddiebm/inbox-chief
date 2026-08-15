"use client";

import { useState } from "react";
import { ROLES } from "@/lib/rbac";
import { product } from "@/lib/product";

/** Demo tenant scope — matches other dashboard panels until auth session scope is wired. */
const DEMO_SCOPE = {
  organizationId: "demo_org",
} as const;

/**
 * Settings panel: invite a teammate by email + role (stub API).
 * Technical Administrator never gets mailbox access automatically.
 */
export function TeamInvitePanel() {
  const [email, setEmail] = useState("");
  const [roleKey, setRoleKey] = useState<(typeof ROLES)[number]["key"]>(
    "executive_assistant",
  );
  const [status, setStatus] = useState(
    "Invite teammates to your organization. Invitations stay scoped to your tenant.",
  );
  const [busy, setBusy] = useState(false);

  const selectedRole = ROLES.find((r) => r.key === roleKey);
  const showMailboxNote =
    selectedRole != null && !selectedRole.grantsMailboxAccessByDefault;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setStatus("Sending invitation…");
    try {
      const res = await fetch("/api/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: DEMO_SCOPE.organizationId,
          callerOrganizationId: DEMO_SCOPE.organizationId,
          email,
          roleKey,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        message?: string;
      };
      if (!res.ok || !data.ok) {
        setStatus(data.error ?? "Could not create invitation.");
        return;
      }
      setEmail("");
      setStatus(data.message ?? "Invitation queued.");
    } catch {
      setStatus("Network error creating invitation.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="settings-block team-invite-panel"
      aria-labelledby="team-invite-heading"
    >
      <h2 id="team-invite-heading">Team invites</h2>
      <p>
        Invite someone to help with {product.name}. Email delivery is a stub for
        now — the request is validated and tenant-scoped.
      </p>

      <form className="team-invite-form" onSubmit={(e) => void onSubmit(e)}>
        <label className="account-data-field" htmlFor="invite-email">
          Email
          <input
            id="invite-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
            placeholder="teammate@example.com"
          />
        </label>

        <label className="account-data-field" htmlFor="invite-role">
          Role
          <select
            id="invite-role"
            value={roleKey}
            onChange={(e) =>
              setRoleKey(e.target.value as (typeof ROLES)[number]["key"])
            }
            disabled={busy}
          >
            {ROLES.map((role) => (
              <option key={role.key} value={role.key}>
                {role.name}
              </option>
            ))}
          </select>
        </label>

        {showMailboxNote ? (
          <p className="team-invite-note" role="note">
            Technical Administrator does not receive mailbox access
            automatically. Grant mailbox access separately if they need to read
            or manage mail.
          </p>
        ) : null}

        <button
          type="submit"
          className="btn-primary"
          disabled={busy || !email.trim()}
          aria-busy={busy}
        >
          {busy ? "Inviting…" : "Send invite"}
        </button>
      </form>

      <p className="status-line" role="status" aria-live="polite">
        {status}
      </p>
    </section>
  );
}

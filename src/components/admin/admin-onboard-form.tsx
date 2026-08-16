"use client";

import { useEffect, useId, useState, type FormEvent } from "react";

type ChecklistItem = {
  id: string;
  label: string;
  done: boolean;
  detail: string;
  copyValue?: string;
};

/** Deep link to the prod project's test-user list — see docs/GOOGLE_OAUTH_PUBLISH.md. */
const GOOGLE_TEST_USERS_URL =
  "https://console.cloud.google.com/auth/audience?project=gen-lang-client-0169179372";

type PendingProvisioning = {
  id: string;
  gmail: string;
  phoneE164: string;
  shortCode: string;
  googleTestUserEnabled: boolean;
  createdAt: string;
};

/**
 * One-screen operator onboard: account + phone + Google test-user confirm + invite helpers.
 * Plain language. No Cloud Console for patrons.
 */
export function AdminOnboardForm() {
  const headingId = useId();
  const statusId = useId();
  const [patronName, setPatronName] = useState("");
  const [gmail, setGmail] = useState("");
  const [phoneE164, setPhoneE164] = useState("");
  const [gmailEnabledConfirmed, setGmailEnabledConfirmed] = useState(false);
  const [resetPassword, setResetPassword] = useState(false);
  const [googlePublished, setGooglePublished] = useState(false);
  const [signInUrl, setSignInUrl] = useState(
    "https://inbox-chief-kappa.vercel.app/signin",
  );
  const [status, setStatus] = useState(
    "Enter patron name, Gmail, and phone. Target: 5 patrons without chaos.",
  );
  const [busy, setBusy] = useState(false);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [copyNote, setCopyNote] = useState("");
  const [pendingProvisioning, setPendingProvisioning] = useState<
    PendingProvisioning[]
  >([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/me");
        const data = (await res.json()) as { isOperator?: boolean };
        if (cancelled) return;
        if (!data.isOperator) {
          setAllowed(false);
          return;
        }
        setAllowed(true);
        const onboardRes = await fetch("/api/admin/onboard");
        const onboard = (await onboardRes.json()) as {
          googlePublished?: boolean;
          signInUrl?: string;
          pendingProvisioning?: PendingProvisioning[];
        };
        if (cancelled) return;
        setGooglePublished(Boolean(onboard.googlePublished));
        setPendingProvisioning(onboard.pendingProvisioning ?? []);
        if (onboard.signInUrl) setSignInUrl(onboard.signInUrl);
        setStatus(
          onboard.googlePublished
            ? "Google verification is live — create patrons and share sign-in. No test-user step."
            : "Google verification is still pending — add each Gmail as a test user, then confirm below.",
        );
      } catch {
        if (!cancelled) setAllowed(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function copyText(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopyNote(`Copied ${label}.`);
    } catch {
      setCopyNote(`Copy failed — select and copy ${label} manually.`);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setTempPassword(null);
    setInviteUrl(null);
    setCopyNote("");
    setStatus("Saving patron…");
    try {
      const res = await fetch("/api/admin/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patronName,
          gmail,
          phoneE164,
          gmailEnabledConfirmed: googlePublished
            ? true
            : gmailEnabledConfirmed,
          resetPassword,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        message?: string;
        checklist?: ChecklistItem[];
        temporaryPassword?: string | null;
        readyForInvite?: boolean;
        inviteUrl?: string;
        signInUrl?: string;
      };
      if (!res.ok || !data.ok) {
        setStatus(data.error ?? "Could not onboard patron.");
        setChecklist([]);
        return;
      }
      setChecklist(data.checklist ?? []);
      setTempPassword(data.temporaryPassword ?? null);
      setInviteUrl(data.inviteUrl ?? data.signInUrl ?? signInUrl);
      setStatus(
        data.message ??
          (data.readyForInvite
            ? "Patron ready — share sign-in link and password."
            : "Saved."),
      );
    } catch {
      setStatus("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function markGmailEnabled(id: string) {
    setStatus("Marking Gmail enabled…");
    try {
      const response = await fetch("/api/admin/onboard", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provisioningRequestId: id,
          googleTestUserEnabled: true,
        }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        message?: string;
      };
      if (!response.ok || !data.ok) {
        setStatus(data.error ?? "Could not update Gmail.");
        return;
      }
      setPendingProvisioning((current) =>
        current.map((item) =>
          item.id === id ? { ...item, googleTestUserEnabled: true } : item,
        ),
      );
      setStatus(data.message ?? "Gmail enabled.");
    } catch {
      setStatus("Network error. Try again.");
    }
  }

  if (allowed === null) {
    return (
      <p className="status-line" role="status" aria-live="polite">
        Checking operator access…
      </p>
    );
  }

  if (!allowed) {
    return (
      <p className="status-line" role="status" aria-live="polite">
        This page is for operators only. Sign in with an operator account.
      </p>
    );
  }

  return (
    <div className="admin-onboard">
      {!googlePublished ? (
        <section
          className="settings-block"
          aria-labelledby="voice-provisioning-heading"
        >
          <h2 id="voice-provisioning-heading">Pending voice signups</h2>
          <p>
            These patrons already finished the phone signup. Paste their Gmail
            addresses into{" "}
            <a
              href={GOOGLE_TEST_USERS_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              Google Audience → Test users
            </a>
            , then mark each one enabled. Their saved link then opens Google
            consent — you never have to message them again.
          </p>
          {pendingProvisioning.length === 0 ? (
            <p role="status">No pending voice signups.</p>
          ) : (
            <>
              {pendingProvisioning.length > 1 ? (
                <p>
                  <button
                    type="button"
                    className="btn"
                    onClick={() =>
                      void copyText(
                        pendingProvisioning.map((item) => item.gmail).join(", "),
                        `all ${pendingProvisioning.length} pending Gmail addresses`,
                      )
                    }
                  >
                    Copy all {pendingProvisioning.length} pending Gmail addresses
                  </button>
                </p>
              ) : null}
              <ul>
              {pendingProvisioning.map((item) => (
                <li key={item.id}>
                  <p>
                    <strong>{item.gmail}</strong>
                    <br />
                    Phone {item.phoneE164}; code {item.shortCode}
                  </p>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => void copyText(item.gmail, "Gmail")}
                  >
                    Copy Gmail
                  </button>{" "}
                  <label>
                    <input
                      type="checkbox"
                      checked={item.googleTestUserEnabled}
                      disabled={item.googleTestUserEnabled}
                      onChange={(event) => {
                        if (event.target.checked) void markGmailEnabled(item.id);
                      }}
                    />{" "}
                    Mark Gmail enabled
                  </label>
                </li>
              ))}
              </ul>
            </>
          )}
        </section>
      ) : null}

      <form
        onSubmit={(e) => void onSubmit(e)}
        className="settings-block"
        aria-labelledby={headingId}
      >
        <h2 id={headingId}>New patron</h2>
        <p>
          One screen: create account, enable call-in phone, confirm Gmail access,
          then copy invite. Patrons never see Google Cloud or env setup.
        </p>

        <div className="form-field">
          <label htmlFor="patron-name">Patron name</label>
          <input
            id="patron-name"
            name="patronName"
            type="text"
            autoComplete="name"
            required
            minLength={2}
            value={patronName}
            onChange={(e) => setPatronName(e.target.value)}
          />
        </div>

        <div className="form-field">
          <label htmlFor="patron-gmail">Gmail</label>
          <input
            id="patron-gmail"
            name="gmail"
            type="email"
            autoComplete="email"
            required
            value={gmail}
            onChange={(e) => setGmail(e.target.value)}
          />
          {gmail.trim() ? (
            <p>
              <button
                type="button"
                className="btn"
                onClick={() =>
                  void copyText(gmail.trim().toLowerCase(), "Gmail")
                }
              >
                Copy Gmail for Google test users
              </button>
            </p>
          ) : null}
        </div>

        <div className="form-field">
          <label htmlFor="patron-phone">Phone (E.164)</label>
          <input
            id="patron-phone"
            name="phoneE164"
            type="tel"
            autoComplete="tel"
            required
            placeholder="+14055551234"
            value={phoneE164}
            onChange={(e) => setPhoneE164(e.target.value)}
          />
        </div>

        {!googlePublished ? (
          <div className="form-field">
            <label>
              <input
                type="checkbox"
                checked={gmailEnabledConfirmed}
                onChange={(e) => setGmailEnabledConfirmed(e.target.checked)}
                required
              />{" "}
              Gmail enabled for this patron (added as Google OAuth test user)
            </label>
            <p>
              Until Google finishes verification, add their Gmail under{" "}
              <a
                href={GOOGLE_TEST_USERS_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                Audience → Test users
              </a>{" "}
              before the invite is ready.
            </p>
          </div>
        ) : (
          <p role="status" aria-live="polite">
            Google OAuth is Published — test-user checklist hidden.
          </p>
        )}

        <div className="form-field">
          <label>
            <input
              type="checkbox"
              checked={resetPassword}
              onChange={(e) => setResetPassword(e.target.checked)}
            />{" "}
            Issue a new temporary password if this account already exists
          </label>
        </div>

        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? "Saving…" : "Create / update & mark ready"}
        </button>
      </form>

      <p id={statusId} className="status-line" role="status" aria-live="polite">
        {status}
        {copyNote ? ` ${copyNote}` : ""}
      </p>

      {tempPassword ? (
        <div className="settings-block" role="status" aria-live="polite">
          <h2>Temporary password</h2>
          <p>
            Share once: <code>{tempPassword}</code>
          </p>
          <button
            type="button"
            className="btn"
            onClick={() => void copyText(tempPassword, "password")}
          >
            Copy password
          </button>
        </div>
      ) : null}

      {inviteUrl ? (
        <div className="settings-block">
          <h2>Invite link</h2>
          <p>
            <a href={inviteUrl}>{inviteUrl}</a>
          </p>
          <button
            type="button"
            className="btn"
            onClick={() => void copyText(inviteUrl, "invite link")}
          >
            Copy invite link
          </button>
        </div>
      ) : null}

      {checklist.length > 0 ? (
        <section
          className="settings-block"
          aria-labelledby="onboard-checklist-heading"
        >
          <h2 id="onboard-checklist-heading">Checklist</h2>
          <ul>
            {checklist.map((item) => (
              <li key={item.id}>
                <strong>{item.done ? "Done" : "Needed"}:</strong> {item.label}{" "}
                — {item.detail}
                {item.copyValue ? (
                  <>
                    {" "}
                    <button
                      type="button"
                      className="btn"
                      onClick={() =>
                        void copyText(item.copyValue!, item.label)
                      }
                    >
                      Copy
                    </button>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section
        className="settings-block"
        aria-labelledby="onboard-runbook-heading"
      >
        <h2 id="onboard-runbook-heading">5 patrons — short path</h2>
        <ol>
          <li>Paste name, Gmail, phone.</li>
          <li>
            {googlePublished
              ? "Submit (Published — no test user)."
              : "Copy Gmail → add as Google test user → check confirm → submit."}
          </li>
          <li>Copy invite link + temporary password → send to patron.</li>
          <li>Patron: sign in → Connect Gmail → call from saved phone.</li>
          <li>Repeat. Use “Issue new temporary password” if they get stuck.</li>
        </ol>
      </section>
    </div>
  );
}

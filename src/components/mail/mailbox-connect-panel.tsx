"use client";

import { useEffect, useId, useState } from "react";
import { gmailConnectedSpoken, gmailNeedsReconnectSpoken } from "@/lib/a11y/copy";
import { GOOGLE_TESTING_CONSENT_GUIDANCE } from "@/lib/google-oauth-publication";
import { humanizeMailboxConnectReason } from "@/lib/mail/connect-errors";
import { product } from "@/lib/product";

type ProviderId = "gmail" | "outlook" | "yahoo" | "icloud" | "imap";

type ProviderCapability = {
  id: ProviderId;
  label: string;
  description: string;
  authMode: "oauth" | "imap_app_password";
  live: boolean;
};

type ImapPreset = {
  provider: "yahoo" | "icloud" | "imap";
  label: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  notes: string;
};

type ConnectedMailbox = {
  id: string;
  emailAddress: string;
  provider: string;
  connectionStatus: string;
  lastSyncedAt: string | null;
};

type MailStatusResponse = {
  ok?: boolean;
  connected?: boolean;
  mailboxes?: ConnectedMailbox[];
  providers?: ProviderCapability[];
  presets?: Record<"yahoo" | "icloud" | "imap", ImapPreset>;
  oauth?: {
    gmail?: boolean;
    outlook?: boolean;
    googleOauthPublished?: boolean;
    gmailMessage?: string | null;
    outlookMessage?: string | null;
  };
  autoSendEnabled?: boolean;
  message?: string;
};

const PROVIDER_TABS: { id: ProviderId; label: string }[] = [
  { id: "gmail", label: "Gmail" },
  { id: "outlook", label: "Outlook" },
  { id: "yahoo", label: "Yahoo" },
  { id: "icloud", label: "iCloud" },
  { id: "imap", label: "Other IMAP" },
];

/**
 * Multi-provider mailbox connect — accessibility-first with spoken status.
 * OAuth for Gmail/Outlook; app-password IMAP for Yahoo/iCloud/Other.
 * Never auto-sends mail after connecting.
 */
export function MailboxConnectPanel() {
  const tabsId = useId();
  const [active, setActive] = useState<ProviderId>("gmail");
  const [status, setStatus] = useState(
    "Checking mailbox connection status…",
  );
  const [mailboxes, setMailboxes] = useState<ConnectedMailbox[]>([]);
  const [oauth, setOauth] = useState<MailStatusResponse["oauth"]>({});
  const [presets, setPresets] = useState<MailStatusResponse["presets"]>();
  const [busy, setBusy] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [imapHost, setImapHost] = useState("");
  const [imapPort, setImapPort] = useState("993");
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("465");

  useEffect(() => {
    let cancelled = false;

    async function loadStatus() {
      try {
        const params = new URLSearchParams(window.location.search);
        const mailboxParam = params.get("mailbox") ?? params.get("gmail");
        const providerParam = (params.get("provider") ??
          (params.get("gmail") ? "gmail" : null)) as ProviderId | null;

        if (mailboxParam === "connected") {
          const emailParam = params.get("email");
          if (!cancelled) {
            if (providerParam) setActive(providerParam);
            setStatus(gmailConnectedSpoken(emailParam));
          }
        } else if (mailboxParam === "error") {
          const reason = params.get("reason") ?? "unknown";
          if (!cancelled) {
            setStatus(humanizeMailboxConnectReason(reason));
          }
        }

        const res = await fetch("/api/mail/status");
        const data = (await res.json()) as MailStatusResponse;
        if (cancelled) return;

        setOauth(data.oauth ?? {});
        setPresets(data.presets);
        setMailboxes(data.mailboxes ?? []);

        if (
          data.mailboxes &&
          data.mailboxes.length > 0 &&
          mailboxParam !== "error"
        ) {
          const primary = data.mailboxes[0]!;
          const synced = primary.lastSyncedAt
            ? ` Last synced ${new Date(primary.lastSyncedAt).toLocaleString()}.`
            : "";
          if (mailboxParam !== "connected") {
            const providerLabel =
              primary.provider === "gmail" ? "Gmail" : primary.provider;
            const statusLower = (primary.connectionStatus ?? "").toLowerCase();
            if (
              primary.provider === "gmail" &&
              (statusLower === "error" || statusLower === "disconnected")
            ) {
              setStatus(gmailNeedsReconnectSpoken(primary.emailAddress));
            } else {
              setStatus(
                primary.provider === "gmail"
                  ? `${gmailConnectedSpoken(primary.emailAddress)}${synced}`
                  : `${providerLabel} connected as ${primary.emailAddress}.${synced} Nothing sends without your approval.`,
              );
            }
          }
        } else if (mailboxParam !== "connected" && mailboxParam !== "error") {
          setStatus(
            data.message ??
              "No mailbox connected yet. Choose a provider and connect with your approval.",
          );
        }
      } catch {
        if (!cancelled) {
          setStatus(
            "No mailbox connected yet. Choose a provider and connect with your approval.",
          );
        }
      }
    }

    void loadStatus();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (active === "yahoo" || active === "icloud" || active === "imap") {
      const preset = presets?.[active];
      if (preset) {
        setImapHost(preset.imapHost);
        setImapPort(String(preset.imapPort));
        setSmtpHost(preset.smtpHost);
        setSmtpPort(String(preset.smtpPort));
      }
    }
  }, [active, presets]);

  async function connectOAuth(provider: "gmail" | "outlook") {
    setBusy(true);
    setStatus(
      provider === "gmail"
        ? "Starting secure Google connection…"
        : "Starting secure Microsoft connection…",
    );
    try {
      const path =
        provider === "gmail" ? "/api/gmail/connect" : "/api/outlook/connect";
      const res = await fetch(path, { method: "POST" });
      const data = (await res.json()) as {
        ok?: boolean;
        url?: string;
        reason?: string;
        message?: string;
      };
      if (data.url) {
        setStatus(
          provider === "gmail"
            ? "Redirecting to Google for permission…"
            : "Redirecting to Microsoft for permission…",
        );
        window.location.href = data.url;
        return;
      }
      setStatus(
        data.message ??
          (data.reason
            ? humanizeMailboxConnectReason(data.reason)
            : `${provider === "gmail" ? "Gmail" : "Outlook"} is not configured yet. You can continue exploring the dashboard.`),
      );
    } catch {
      setStatus(
        `Could not start ${provider === "gmail" ? "Gmail" : "Outlook"} connection. Please try again.`,
      );
    } finally {
      setBusy(false);
    }
  }

  async function connectImap() {
    setBusy(true);
    setStatus("Saving encrypted IMAP credentials…");
    try {
      const res = await fetch("/api/mail/imap/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: active,
          emailAddress: email,
          password,
          imapHost,
          imapPort: Number(imapPort),
          smtpHost,
          smtpPort: Number(smtpPort),
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        emailAddress?: string;
        message?: string;
        reason?: string;
        stub?: boolean;
      };
      if (data.ok) {
        setPassword("");
        setStatus(
          data.message ??
            gmailConnectedSpoken(data.emailAddress),
        );
        setMailboxes((prev) => {
          if (!data.emailAddress) return prev;
          const next = prev.filter((m) => m.emailAddress !== data.emailAddress);
          return [
            {
              id: "local",
              emailAddress: data.emailAddress,
              provider: active,
              connectionStatus: "connected",
              lastSyncedAt: null,
            },
            ...next,
          ];
        });
      } else {
        setStatus(data.message ?? data.reason ?? "IMAP connection failed.");
      }
    } catch {
      setStatus("Could not connect IMAP mailbox. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function disconnectMailbox(mailbox: ConnectedMailbox) {
    setBusy(true);
    setStatus(`Disconnecting ${mailbox.emailAddress}…`);
    try {
      const res = await fetch("/api/mail/disconnect", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mailboxId: mailbox.id }),
      });
      const data = (await res.json()) as { ok?: boolean; message?: string };
      if (!res.ok || !data.ok) {
        setStatus(data.message ?? "Could not disconnect this mailbox.");
        return;
      }
      setMailboxes((current) => current.filter((item) => item.id !== mailbox.id));
      setStatus(
        data.message ??
          `${mailbox.emailAddress} is disconnected. Sync and call-in reading have stopped.`,
      );
    } catch {
      setStatus("Could not disconnect this mailbox. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const isImapFamily =
    active === "yahoo" || active === "icloud" || active === "imap";
  const presetNotes =
    isImapFamily && presets?.[active] ? presets[active].notes : null;
  const gmailNeedsReconnect = mailboxes.some(
    (mailbox) =>
      mailbox.provider === "gmail" &&
      mailbox.connectionStatus.toLowerCase() !== "connected",
  );

  return (
    <section
      className="mailbox-connect settings-block"
      aria-labelledby="mailbox-connect-heading"
    >
      <h2 id="mailbox-connect-heading">Connect your mailbox</h2>
      <p>
        Connect Gmail with one approval screen. {product.name} never sends mail
        without your approval. Other providers are available below if you need
        them.
      </p>

      <p className="status-line" role="status" aria-live="assertive">
        {status}
      </p>

      <div
        role="tablist"
        aria-label="Mailbox providers"
        className="mailbox-connect__tabs"
      >
        {PROVIDER_TABS.map((tab) => {
          const selected = active === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`${tabsId}-${tab.id}`}
              aria-selected={selected}
              aria-controls={`${tabsId}-panel`}
              tabIndex={selected ? 0 : -1}
              className={
                selected
                  ? "mailbox-connect__tab mailbox-connect__tab--active"
                  : "mailbox-connect__tab"
              }
              onClick={() => setActive(tab.id)}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`${tabsId}-panel`}
        aria-labelledby={`${tabsId}-${active}`}
        className="mailbox-connect__panel"
      >
        {active === "gmail" ? (
          <>
            <p>
              Connect Google Workspace or personal Gmail. Inbox Chief can read
              your mail and can send only after you approve a draft.
            </p>
            {!oauth?.gmail ? (
              <p className="mailbox-connect__hint">
                {humanizeMailboxConnectReason("gmail_not_configured")}
              </p>
            ) : (
              <>
                <p className="mailbox-connect__hint">
                  You’ll approve access on Google’s secure screen.
                </p>
                {oauth.googleOauthPublished === false ? (
                  <p className="mailbox-connect__hint" role="note">
                    <strong>Google notice:</strong>{" "}
                    {GOOGLE_TESTING_CONSENT_GUIDANCE}
                  </p>
                ) : null}
              </>
            )}
            <button
              type="button"
              className="btn-primary"
              onClick={() => void connectOAuth("gmail")}
              disabled={busy || !oauth?.gmail}
              aria-busy={busy}
            >
              {busy
                ? "Connecting…"
                : gmailNeedsReconnect
                  ? "Reconnect Gmail"
                  : "Connect Gmail"}
            </button>
          </>
        ) : null}

        {active === "outlook" ? (
          <>
            <p>
              Connect Outlook or Microsoft 365 via Microsoft identity and Graph
              API. Scopes: Mail.Read and Mail.Send (send only after approval).
            </p>
            {!oauth?.outlook ? (
              <p className="mailbox-connect__hint">
                Inbox Chief isn’t ready to connect Outlook yet. Please contact
                support.
              </p>
            ) : null}
            <button
              type="button"
              className="btn-primary"
              onClick={() => void connectOAuth("outlook")}
              disabled={busy}
              aria-busy={busy}
            >
              {busy ? "Connecting…" : "Connect Outlook account"}
            </button>
          </>
        ) : null}

        {isImapFamily ? (
          <>
            <p>
              {active === "yahoo"
                ? "Yahoo Mail uses IMAP with an app password."
                : active === "icloud"
                  ? "iCloud Mail uses IMAP with an Apple app-specific password."
                  : "Connect any provider that supports IMAP and SMTP (custom domains included)."}
            </p>
            {presetNotes ? (
              <p className="mailbox-connect__hint">{presetNotes}</p>
            ) : null}
            <form
              className="mailbox-connect__form"
              onSubmit={(e) => {
                e.preventDefault();
                void connectImap();
              }}
            >
              <label>
                Email address
                <input
                  type="email"
                  name="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              <label>
                App password
                <input
                  type="password"
                  name="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <div className="mailbox-connect__hosts">
                <label>
                  IMAP host
                  <input
                    type="text"
                    name="imapHost"
                    required
                    value={imapHost}
                    onChange={(e) => setImapHost(e.target.value)}
                    readOnly={active !== "imap"}
                  />
                </label>
                <label>
                  IMAP port
                  <input
                    type="number"
                    name="imapPort"
                    required
                    min={1}
                    max={65535}
                    value={imapPort}
                    onChange={(e) => setImapPort(e.target.value)}
                    readOnly={active !== "imap"}
                  />
                </label>
                <label>
                  SMTP host
                  <input
                    type="text"
                    name="smtpHost"
                    required
                    value={smtpHost}
                    onChange={(e) => setSmtpHost(e.target.value)}
                    readOnly={active !== "imap"}
                  />
                </label>
                <label>
                  SMTP port
                  <input
                    type="number"
                    name="smtpPort"
                    required
                    min={1}
                    max={65535}
                    value={smtpPort}
                    onChange={(e) => setSmtpPort(e.target.value)}
                    readOnly={active !== "imap"}
                  />
                </label>
              </div>
              <button
                type="submit"
                className="btn-primary"
                disabled={busy}
                aria-busy={busy}
              >
                {busy ? "Connecting…" : `Connect ${PROVIDER_TABS.find((t) => t.id === active)?.label}`}
              </button>
            </form>
          </>
        ) : null}
      </div>

      {mailboxes.length > 0 ? (
        <ul className="mailbox-connect__list" aria-label="Connected mailboxes">
          {mailboxes.map((m) => (
            <li key={`${m.provider}-${m.emailAddress}-${m.id}`}>
              <strong>{m.emailAddress}</strong> — {m.provider}
              {m.lastSyncedAt
                ? ` · synced ${new Date(m.lastSyncedAt).toLocaleString()}`
                : null}
              {" "}
              {m.provider === "gmail" &&
              m.connectionStatus.toLowerCase() !== "connected" ? (
                <button
                  type="button"
                  className="btn-primary"
                  disabled={busy}
                  onClick={() => void connectOAuth("gmail")}
                  aria-label={`Reconnect Gmail for ${m.emailAddress}`}
                >
                  Reconnect Gmail
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={busy || m.id === "local"}
                  onClick={() => void disconnectMailbox(m)}
                  aria-label={`Disconnect ${m.emailAddress}`}
                >
                  Disconnect
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

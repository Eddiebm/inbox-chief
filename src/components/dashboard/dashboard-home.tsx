"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { STORAGE_KEY } from "@/components/onboarding/questions";
import { getPersonalizedGreeting } from "@/lib/greeting";

type LiveStatus = {
  loading: boolean;
  isMock: boolean;
  mailboxConnected: boolean;
  mailboxEmail: string | null;
  statusLine: string;
  attentionCount: number;
  draftCount: number;
};

function readPreferredName(): string {
  if (typeof window === "undefined") return "there";
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return "there";
    const parsed = JSON.parse(raw) as {
      answers?: Record<string, string>;
      preferredName?: string;
      assistantCallYou?: string;
    };
    const fromAnswers =
      parsed.answers?.preferredName?.trim() ||
      parsed.answers?.assistantCallYou?.trim();
    const fromRoot =
      parsed.preferredName?.trim() || parsed.assistantCallYou?.trim();
    return fromAnswers || fromRoot || "there";
  } catch {
    return "there";
  }
}

function subscribeName(onChange: () => void) {
  if (typeof window === "undefined") return () => {};
  const handler = () => onChange();
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}

type WorkSurfaceProps = {
  id: string;
  title: string;
  statusText: string;
  description: string;
  href?: string;
  actionLabel?: string;
  children?: ReactNode;
};

function WorkSurface({
  id,
  title,
  statusText,
  description,
  href,
  actionLabel,
  children,
}: WorkSurfaceProps) {
  return (
    <article className="dash-surface" aria-labelledby={id}>
      <header className="dash-surface__header">
        <h2 id={id} className="dash-surface__title">
          {title}
        </h2>
        <p className="dash-surface__status">
          <span className="sr-only">Status: </span>
          {statusText}
        </p>
      </header>
      <p className="dash-surface__desc">{description}</p>
      {children}
      {href && actionLabel ? (
        <p className="dash-surface__actions">
          <Link href={href} className="btn btn--primary">
            {actionLabel}
          </Link>
        </p>
      ) : null}
    </article>
  );
}

export function DashboardHome() {
  const firstName = useSyncExternalStore(
    subscribeName,
    readPreferredName,
    () => "there",
  );
  const greeting = getPersonalizedGreeting(firstName);
  const [live, setLive] = useState<LiveStatus>({
    loading: true,
    isMock: false,
    mailboxConnected: false,
    mailboxEmail: null,
    statusLine: "Loading your mailbox status…",
    attentionCount: 0,
    draftCount: 0,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [meRes, mailRes, inboxRes, draftsRes] = await Promise.all([
          fetch("/api/auth/me"),
          fetch("/api/mail/status"),
          fetch("/api/inbox"),
          fetch("/api/drafts"),
        ]);
        const me = (await meRes.json()) as { isMock?: boolean };
        const mail = (await mailRes.json()) as {
          connected?: boolean;
          email?: string | null;
          mailbox?: { emailAddress?: string | null };
          message?: string;
        };
        const inbox = (await inboxRes.json()) as {
          items?: Array<{ needsAttention?: boolean; status?: string }>;
        };
        const drafts = (await draftsRes.json()) as { items?: unknown[] };
        if (cancelled) return;
        const connected = Boolean(mail.connected);
        const email =
          mail.email ?? mail.mailbox?.emailAddress ?? null;
        const attentionCount = (inbox.items ?? []).filter(
          (item) => item.needsAttention && item.status === "NEW",
        ).length;
        setLive({
          loading: false,
          isMock: Boolean(me.isMock),
          mailboxConnected: connected,
          mailboxEmail: email,
          statusLine: connected
            ? `Primary mailbox connected${email ? `: ${email}` : ""}.`
            : "No mailbox connected yet. Connect Gmail in Settings to sync your Primary inbox.",
          attentionCount,
          draftCount: (drafts.items ?? []).length,
        });
      } catch {
        if (!cancelled) {
          setLive({
            loading: false,
            isMock: false,
            mailboxConnected: false,
            mailboxEmail: null,
            statusLine:
              "Could not load mailbox status. Open Settings to connect Gmail.",
            attentionCount: 0,
            draftCount: 0,
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="dash-main">
      <header className="dash-welcome">
        <h1 className="dash-welcome__greeting">{greeting}</h1>
        <p className="dash-welcome__lead">
          Your assistant overview. Connect Gmail, save your call-in phone, then
          ask anytime — nothing sends without your approval.
        </p>
        <p className="dash-welcome__callin">
          Need an update right now?{" "}
          <Link href="/dashboard/call-in">Call in or ask anytime</Link> —
          Primary inbox only. Nothing sends from that conversation.
        </p>
        <p className="status-line" role="status" aria-live="polite">
          {live.statusLine}
        </p>
      </header>

      <div className="dash-grid" role="region" aria-label="Dashboard overview">
        <WorkSurface
          id="surface-mailbox"
          title="Connected mailbox"
          statusText={
            live.loading
              ? "Checking…"
              : live.mailboxConnected
                ? "Connected"
                : "No mailbox connected"
          }
          description={
            live.mailboxConnected
              ? "Your Primary inbox is linked for triage, drafts, and call-in."
              : "Link Gmail securely so the assistant can read Primary mail aloud and draft under your rules."
          }
          href="/dashboard/settings"
          actionLabel={
            live.mailboxConnected
              ? "Open connection settings"
              : "Connect Gmail"
          }
        >
          <p className="dash-metric">
            <span className="dash-metric__value">
              {live.mailboxConnected ? "1" : "0"}
            </span>
            <span className="dash-metric__label"> live mailboxes</span>
          </p>
        </WorkSurface>

        <WorkSurface
          id="surface-attention"
          title="Messages needing attention"
          statusText={
            live.mailboxConnected
              ? `${live.attentionCount} in Primary`
              : "Connect Gmail to sync Primary mail"
          }
          description="Priority Primary items from your connected mailbox. Open Inbox to triage, or call in to hear them."
          href="/dashboard/inbox"
          actionLabel="Open inbox"
        >
          <p className="dash-metric">
            <span className="dash-metric__value">{live.attentionCount}</span>
            <span className="dash-metric__label"> needing attention</span>
          </p>
        </WorkSurface>

        <WorkSurface
          id="surface-drafts"
          title="Drafts awaiting review"
          statusText="Never auto-send"
          description="Suggested replies from Inbox or Call in. You always review before anything sends."
          href="/dashboard/drafts"
          actionLabel="Open drafts"
        >
          <p className="dash-metric">
            <span className="dash-metric__value">{live.draftCount}</span>
            <span className="dash-metric__label"> drafts</span>
          </p>
        </WorkSurface>

        <WorkSurface
          id="surface-callin"
          title="Anytime call-in"
          statusText="Primary only · never sends"
          description="Save the phone you call from under Settings, then dial the shared number anytime."
          href="/dashboard/call-in"
          actionLabel="Open call-in"
        >
          <p className="dash-empty">
            Unrecognized phones hear a short setup tip — never invented mail.
          </p>
        </WorkSurface>

        <WorkSurface
          id="surface-security"
          title="Security and connection"
          statusText={
            live.mailboxConnected
              ? "Mailbox linked"
              : "Mailbox not linked yet"
          }
          description="Session stays encrypted in transit. Connect Gmail when you are ready — you stay in control of sending."
          href="/dashboard/settings"
          actionLabel="Open settings"
        >
          <ul className="dash-status-list">
            <li>
              <span
                className="dash-status-dot dash-status-dot--ok"
                aria-hidden="true"
              />
              <span>Session: secure — encrypted in transit</span>
            </li>
            <li>
              <span
                className={
                  live.mailboxConnected
                    ? "dash-status-dot dash-status-dot--ok"
                    : "dash-status-dot dash-status-dot--warn"
                }
                aria-hidden="true"
              />
              <span>
                Mailbox:{" "}
                {live.mailboxConnected
                  ? "connected"
                  : "not connected — connect to sync live mail"}
              </span>
            </li>
          </ul>
        </WorkSurface>
      </div>
    </div>
  );
}

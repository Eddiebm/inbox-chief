"use client";

import { useMemo, useState } from "react";
import { speakReceivedAt } from "@/lib/call-in/speak-received";
import { demoInbox, triageMessage, type TriageMessage } from "@/lib/inbox";
import { speak } from "@/lib/voice/speech";
import { product } from "@/lib/product";

const DEMO_SCOPE = {
  organizationId: "demo_org",
  workspaceId: "demo_ws",
  mailboxId: "demo_mb",
  userId: "demo_user",
};

export function InboxPanel() {
  const initial = useMemo(() => demoInbox(DEMO_SCOPE), []);
  const [items, setItems] = useState<TriageMessage[]>(initial);
  const [status, setStatus] = useState(
    `${product.name} organizes mail into clear categories. Pick a message to hear details and triage.`,
  );
  const [selectedId, setSelectedId] = useState<string | null>(
    initial.find((i) => i.needsAttention)?.id ?? initial[0]?.id ?? null,
  );

  const selected = items.find((i) => i.id === selectedId) ?? null;
  const attention = items.filter((i) => i.needsAttention && i.status === "NEW");

  async function announce(message: string) {
    setStatus(message);
    await speak(message);
  }

  async function act(action: "mark_triaged" | "defer" | "archive") {
    if (!selected) return;
    try {
      const result = triageMessage(selected, action, DEMO_SCOPE);
      setItems((prev) =>
        prev.map((i) => (i.id === result.item.id ? result.item : i)),
      );
      await announce(result.spoken);
    } catch (err) {
      await announce(err instanceof Error ? err.message : "Action blocked.");
    }
  }

  return (
    <div className="inbox-panel">
      <header className="page-header">
        <h1>Inbox</h1>
        <p>
          Triage by category without losing control. Status is always announced
          in words — never color alone.
        </p>
      </header>

      <p className="status-line" role="status" aria-live="assertive">
        {status}
      </p>
      <p role="status">
        {attention.length} message{attention.length === 1 ? "" : "s"} needing
        attention
        {attention.length === 0
          ? " — no Primary messages need attention yet. Connect Gmail in Settings if your inbox is empty."
          : "."}
      </p>

      <ul className="inbox-list" aria-label="Inbox messages">
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className={
                item.id === selectedId ? "inbox-item is-selected" : "inbox-item"
              }
              onClick={() => {
                setSelectedId(item.id);
                const received = speakReceivedAt(
                  item.receivedAt,
                  Intl.DateTimeFormat().resolvedOptions().timeZone,
                );
                setStatus(
                  `From ${item.fromAddress}. Subject ${item.subject}.${received ? ` ${received}.` : ""} Category ${item.category}. ${item.snippet} Status ${item.status.toLowerCase()}. ${item.needsAttention ? "Needs attention." : "Not urgent."}`,
                );
              }}
              aria-current={item.id === selectedId ? "true" : undefined}
            >
              <span className="inbox-item__subject">{item.subject}</span>
              <span className="inbox-item__meta">
                {item.fromAddress} · {item.category}
                {item.needsAttention ? " · Needs attention" : ""} · {item.status}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {selected ? (
        <div className="inbox-actions" role="group" aria-label="Triage actions">
          <button
            type="button"
            className="btn-primary"
            disabled={selected.status !== "NEW"}
            onClick={() => void act("mark_triaged")}
          >
            Mark triaged
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={selected.status !== "NEW"}
            onClick={() => void act("defer")}
          >
            Defer
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={selected.status !== "NEW"}
            onClick={() => void act("archive")}
          >
            Archive
          </button>
          <a className="btn-secondary" href="/dashboard/approvals">
            Review drafts
          </a>
        </div>
      ) : null}
    </div>
  );
}

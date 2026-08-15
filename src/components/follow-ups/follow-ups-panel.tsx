"use client";

import { useMemo, useState } from "react";
import {
  demoFollowUps,
  updateFollowUp,
  type FollowUpItem,
} from "@/lib/follow-ups";
import { speak } from "@/lib/voice/speech";
import { product } from "@/lib/product";

const DEMO_SCOPE = {
  organizationId: "demo_org",
  workspaceId: "demo_ws",
  mailboxId: "demo_mb",
  userId: "demo_user",
};

export function FollowUpsPanel() {
  const initial = useMemo(() => demoFollowUps(DEMO_SCOPE), []);
  const [items, setItems] = useState<FollowUpItem[]>(initial);
  const [status, setStatus] = useState(
    `${product.name} tracks follow-ups so nothing slips. Ask about them anytime on Call in.`,
  );
  const [selectedId, setSelectedId] = useState<string | null>(
    initial[0]?.id ?? null,
  );

  const selected = items.find((i) => i.id === selectedId) ?? null;
  const open = items.filter((i) => i.status === "OPEN");

  async function announce(message: string) {
    setStatus(message);
    await speak(message);
  }

  async function act(action: "complete" | "snooze") {
    if (!selected) return;
    try {
      const result = updateFollowUp(selected, action, DEMO_SCOPE);
      setItems((prev) =>
        prev.map((i) => (i.id === result.item.id ? result.item : i)),
      );
      await announce(result.spoken);
    } catch (err) {
      await announce(err instanceof Error ? err.message : "Action blocked.");
    }
  }

  return (
    <div className="followups-panel">
      <header className="page-header">
        <h1>Follow-ups</h1>
        <p>
          Threads waiting on someone else — or on you. Complete or snooze with
          clear spoken confirmation.
        </p>
      </header>

      <p className="status-line" role="status" aria-live="assertive">
        {status}
      </p>
      <p role="status">
        {open.length} open follow-up{open.length === 1 ? "" : "s"}
        {open.length === 0 ? " — none due right now." : "."}
      </p>

      <ul className="followups-list" aria-label="Follow-up items">
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className={
                item.id === selectedId
                  ? "followups-item is-selected"
                  : "followups-item"
              }
              onClick={() => {
                setSelectedId(item.id);
                setStatus(
                  `${item.subject}. With ${item.counterparty}. Due ${item.dueLabel}. ${item.note} Status ${item.status.toLowerCase()}.`,
                );
              }}
              aria-current={item.id === selectedId ? "true" : undefined}
            >
              <span className="followups-item__subject">{item.subject}</span>
              <span className="followups-item__meta">
                {item.counterparty} · due {item.dueLabel} · {item.status}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {selected ? (
        <div className="followups-actions" role="group" aria-label="Follow-up actions">
          <button
            type="button"
            className="btn-primary"
            disabled={selected.status !== "OPEN"}
            onClick={() => void act("complete")}
          >
            Mark complete
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={selected.status !== "OPEN"}
            onClick={() => void act("snooze")}
          >
            Snooze 3 days
          </button>
        </div>
      ) : null}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import type { FollowUpItem } from "@/lib/follow-ups";
import { speak } from "@/lib/voice/speech";
import { product } from "@/lib/product";

export function FollowUpsPanel() {
  const [items, setItems] = useState<FollowUpItem[]>([]);
  const [mailboxConnected, setMailboxConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(
    `${product.name} is loading follow-ups from your mailbox.`,
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = items.find((i) => i.id === selectedId) ?? null;
  const open = items.filter((i) => i.status === "OPEN" || i.status === "SNOOZED");

  async function announce(message: string) {
    setStatus(message);
    await speak(message);
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/follow-ups");
        const data = (await response.json()) as {
          items?: FollowUpItem[];
          mailboxConnected?: boolean;
        };
        if (cancelled) return;
        const loaded = data.items ?? [];
        setMailboxConnected(Boolean(data.mailboxConnected));
        setItems(loaded);
        setSelectedId(loaded[0]?.id ?? null);
        if (!data.mailboxConnected) {
          setStatus(
            "Connect Gmail in Settings to track live follow-ups. This page never shows sample mail.",
          );
        } else if (loaded.length === 0) {
          setStatus(
            "No follow-ups yet. In Inbox, choose Defer on a message to set a 3-day reminder.",
          );
        } else {
          setStatus(
            `${loaded.length} follow-up${loaded.length === 1 ? "" : "s"} loaded.`,
          );
        }
      } catch {
        if (!cancelled) setStatus("Could not load follow-ups right now.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function act(action: "complete" | "snooze") {
    if (!selected) return;
    try {
      const response = await fetch("/api/follow-ups", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: selected.id, action }),
      });
      const data = (await response.json()) as {
        item?: FollowUpItem;
        spoken?: string;
        message?: string;
      };
      if (!response.ok) {
        throw new Error(data.message ?? "That follow-up could not be saved.");
      }
      if (data.item) {
        setItems((prev) =>
          prev.map((i) => (i.id === data.item!.id ? data.item! : i)),
        );
      }
      await announce(data.spoken ?? "Saved.");
    } catch (err) {
      await announce(err instanceof Error ? err.message : "Action blocked.");
    }
  }

  return (
    <div className="followups-panel">
      <header className="page-header">
        <h1>Follow-ups</h1>
        <p>
          Reminders created when you defer live mail. Complete or snooze with
          clear spoken confirmation. Nothing sends from this page.
        </p>
      </header>

      <p className="status-line" role="status" aria-live="assertive">
        {status}
      </p>
      <p role="status">
        {loading
          ? "Loading."
          : !mailboxConnected
            ? "No mailbox connected."
            : `${open.length} open follow-up${open.length === 1 ? "" : "s"}${
                open.length === 0 ? " — none due right now." : "."
              }`}
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
                void announce(
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
            disabled={selected.status === "COMPLETED"}
            onClick={() => void act("complete")}
          >
            Mark complete
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={selected.status === "COMPLETED"}
            onClick={() => void act("snooze")}
          >
            Snooze 3 days
          </button>
        </div>
      ) : !loading && !mailboxConnected ? (
        <p>
          <a className="btn-primary" href="/dashboard/settings">
            Connect Gmail
          </a>
        </p>
      ) : null}
    </div>
  );
}

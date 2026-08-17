"use client";

import { useEffect, useState } from "react";
import { speakReceivedAt } from "@/lib/call-in/speak-received";
import type { TriageMessage } from "@/lib/inbox";
import { speak } from "@/lib/voice/speech";
import { product } from "@/lib/product";

export function InboxPanel() {
  const [items, setItems] = useState<TriageMessage[]>([]);
  const [mailboxConnected, setMailboxConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(
    `${product.name} is loading your Primary inbox.`,
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = items.find((i) => i.id === selectedId) ?? null;
  const attention = items.filter((i) => i.needsAttention && i.status === "NEW");

  async function announce(message: string) {
    setStatus(message);
    await speak(message);
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/inbox");
        const data = (await response.json()) as {
          items?: TriageMessage[];
          mailboxConnected?: boolean;
        };
        if (cancelled) return;
        const loaded = data.items ?? [];
        setMailboxConnected(Boolean(data.mailboxConnected));
        setItems(loaded);
        setSelectedId(loaded[0]?.id ?? null);
        if (!data.mailboxConnected) {
          setStatus(
            "Connect Gmail in Settings to triage your live Primary mail. This page never shows sample mail.",
          );
        } else if (loaded.length === 0) {
          setStatus(
            "Your Primary inbox has no messages to triage yet. Call in to hear mail after sync, or wait for new Primary mail.",
          );
        } else {
          setStatus(
            `${loaded.length} Primary message${loaded.length === 1 ? "" : "s"} loaded. Pick one to hear details.`,
          );
        }
      } catch {
        if (!cancelled) {
          setStatus("Could not load your inbox right now.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function act(action: "mark_triaged" | "defer" | "archive") {
    if (!selected) return;
    try {
      const response = await fetch("/api/inbox", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: selected.id, action }),
      });
      const data = (await response.json()) as {
        item?: TriageMessage;
        spoken?: string;
        message?: string;
      };
      if (!response.ok) {
        throw new Error(data.message ?? "That action could not be saved.");
      }
      if (data.item) {
        setItems((prev) => {
          const next = prev.map((i) => (i.id === data.item!.id ? data.item! : i));
          return action === "archive"
            ? next.filter((i) => i.id !== data.item!.id)
            : next;
        });
      }
      await announce(data.spoken ?? "Saved.");
    } catch (err) {
      await announce(err instanceof Error ? err.message : "Action blocked.");
    }
  }

  async function draftReply() {
    if (!selected) return;
    try {
      const response = await fetch("/api/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: selected.id }),
      });
      const data = (await response.json()) as {
        spoken?: string;
        message?: string;
      };
      if (!response.ok) {
        throw new Error(data.message ?? "Could not create a draft.");
      }
      await announce(
        data.spoken ??
          "Draft ready on the Drafts page. Nothing was sent.",
      );
    } catch (err) {
      await announce(err instanceof Error ? err.message : "Draft blocked.");
    }
  }

  function select(item: TriageMessage) {
    setSelectedId(item.id);
    const received = speakReceivedAt(
      item.receivedAt,
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
    void announce(
      `From ${item.fromAddress}. Subject ${item.subject}.${received ? ` ${received}.` : ""} Category ${item.category}. ${item.snippet} Status ${item.status.toLowerCase()}. ${item.needsAttention ? "Needs attention." : "Not urgent."}`,
    );
  }

  return (
    <div className="inbox-panel">
      <header className="page-header">
        <h1>Inbox</h1>
        <p>
          Live Primary mail from your connected mailbox. Status is always
          announced in words — never color alone. Nothing sends from this page.
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
            : `${attention.length} message${attention.length === 1 ? "" : "s"} needing attention.`}
      </p>

      <ul className="inbox-list" aria-label="Inbox messages">
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className={
                item.id === selectedId ? "inbox-item is-selected" : "inbox-item"
              }
              onClick={() => select(item)}
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
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void draftReply()}
          >
            Draft a reply
          </button>
          <a className="btn-secondary" href="/dashboard/approvals">
            Review drafts
          </a>
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

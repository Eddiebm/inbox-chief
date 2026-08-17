"use client";

import { useEffect, useState } from "react";
import type { DraftItem } from "@/lib/drafts";
import { speak } from "@/lib/voice/speech";
import { product } from "@/lib/product";

export function DraftsPanel() {
  const [items, setItems] = useState<DraftItem[]>([]);
  const [mailboxConnected, setMailboxConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(
    `${product.name} is loading drafts from your mailbox.`,
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");

  const selected = items.find((i) => i.id === selectedId) ?? null;
  const active = items.filter((i) => i.status !== "DISCARDED");

  async function announce(message: string) {
    setStatus(message);
    await speak(message);
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/drafts");
        const data = (await response.json()) as {
          items?: DraftItem[];
          mailboxConnected?: boolean;
        };
        if (cancelled) return;
        const loaded = data.items ?? [];
        setMailboxConnected(Boolean(data.mailboxConnected));
        setItems(loaded);
        setSelectedId(loaded[0]?.id ?? null);
        setEditBody(loaded[0]?.bodyText ?? "");
        if (!data.mailboxConnected) {
          setStatus(
            "Connect Gmail in Settings to review live drafts. This page never shows sample mail.",
          );
        } else if (loaded.length === 0) {
          setStatus(
            "No drafts waiting. Open Inbox and choose Draft a reply, or compose on a call. Nothing sends until you approve.",
          );
        } else {
          setStatus(
            `${loaded.length} draft${loaded.length === 1 ? "" : "s"} loaded. Review, then send to approvals.`,
          );
        }
      } catch {
        if (!cancelled) setStatus("Could not load drafts right now.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function select(item: DraftItem) {
    setSelectedId(item.id);
    setEditBody(item.bodyText);
    void announce(
      `Draft: ${item.subject}. To ${item.toAddresses.join(", ")}. Status ${item.status.replaceAll("_", " ").toLowerCase()}.`,
    );
  }

  async function act(action: "edit" | "request_approval" | "discard") {
    if (!selected) return;
    try {
      const response = await fetch("/api/drafts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: selected.id,
          action,
          bodyText: action === "edit" ? editBody : undefined,
        }),
      });
      const data = (await response.json()) as {
        item?: DraftItem;
        spoken?: string;
        message?: string;
      };
      if (!response.ok) {
        throw new Error(data.message ?? "That draft could not be saved.");
      }
      if (data.item) {
        setItems((prev) =>
          prev.map((i) => (i.id === data.item!.id ? data.item! : i)),
        );
        if (action === "edit") setEditBody(data.item.bodyText);
      }
      await announce(data.spoken ?? "Saved.");
    } catch (err) {
      await announce(err instanceof Error ? err.message : "Action blocked.");
    }
  }

  return (
    <div className="drafts-panel">
      <header className="page-header">
        <h1>Drafts</h1>
        <p>
          Replies prepared from your live mail. Request approval when ready —
          sending still requires a separate confirmation on Approvals.
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
            : `${active.length} active draft${active.length === 1 ? "" : "s"}${
                active.length === 0 ? " — nothing waiting for review yet." : "."
              }`}
      </p>

      <ul className="drafts-list" aria-label="Draft messages">
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className={
                item.id === selectedId ? "drafts-item is-selected" : "drafts-item"
              }
              onClick={() => select(item)}
              aria-current={item.id === selectedId ? "true" : undefined}
            >
              <span className="drafts-item__subject">{item.subject}</span>
              <span className="drafts-item__meta">
                {item.toAddresses.join(", ")} ·{" "}
                {item.status.replaceAll("_", " ")}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {selected && selected.status !== "DISCARDED" ? (
        <section className="drafts-editor" aria-labelledby="draft-editor-heading">
          <h2 id="draft-editor-heading">{selected.subject}</h2>
          <label htmlFor="draft-body">
            Draft body
            <textarea
              id="draft-body"
              rows={6}
              value={editBody}
              onChange={(e) => setEditBody(e.target.value)}
            />
          </label>
          <div className="drafts-actions" role="group" aria-label="Draft actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => void act("edit")}
            >
              Save edits
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={selected.status === "AWAITING_APPROVAL"}
              onClick={() => void act("request_approval")}
            >
              Request approval
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => void act("discard")}
            >
              Discard
            </button>
            <a className="btn-secondary" href="/dashboard/approvals">
              Open approvals
            </a>
          </div>
        </section>
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

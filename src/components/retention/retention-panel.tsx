"use client";

import { useEffect, useState } from "react";
import type { RetentionCandidate } from "@/lib/retention";
import { speak } from "@/lib/voice/speech";
import { product } from "@/lib/product";

export function RetentionPanel() {
  const [items, setItems] = useState<RetentionCandidate[]>([]);
  const [mailboxConnected, setMailboxConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(
    `${product.name} is loading retention candidates from your mailbox.`,
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = items.find((i) => i.id === selectedId) ?? null;
  const open = items.filter((i) => i.status === "CANDIDATE");

  async function announce(message: string) {
    setStatus(message);
    await speak(message);
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/retention");
        const data = (await response.json()) as {
          items?: RetentionCandidate[];
          mailboxConnected?: boolean;
          retainDays?: number;
        };
        if (cancelled) return;
        const loaded = data.items ?? [];
        setMailboxConnected(Boolean(data.mailboxConnected));
        setItems(loaded);
        setSelectedId(loaded[0]?.id ?? null);
        if (!data.mailboxConnected) {
          setStatus(
            "Connect Gmail in Settings to review old mail. This page never shows sample mail.",
          );
        } else if (loaded.length === 0) {
          setStatus(
            `Nothing past your ${data.retainDays ?? 90}-day retention window yet. Primary mail is protected from Trash.`,
          );
        } else {
          setStatus(
            `${loaded.length} candidate${loaded.length === 1 ? "" : "s"} older than ${data.retainDays ?? 90} days. Keep or approve for Trash review — Gmail is not deleted here.`,
          );
        }
      } catch {
        if (!cancelled) setStatus("Could not load retention right now.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function act(decision: "keep" | "approve_trash") {
    if (!selected) return;
    try {
      const response = await fetch("/api/retention", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: selected.id, action: decision }),
      });
      const data = (await response.json()) as {
        item?: RetentionCandidate;
        spoken?: string;
        message?: string;
      };
      if (!response.ok) {
        throw new Error(data.message ?? "That decision could not be saved.");
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
    <div className="retention-panel">
      <header className="page-header">
        <h1>Retention center</h1>
        <p>
          Old mail from your connected mailbox. Protected categories cannot be
          trashed. Inbox Chief never deletes Gmail from this page.
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
            : `${open.length} candidate${open.length === 1 ? "" : "s"} waiting for review${
                open.length === 0 ? " — nothing past retention yet." : "."
              }`}
      </p>

      <ul className="retention-list" aria-label="Retention candidates">
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className={
                item.id === selectedId
                  ? "retention-item is-selected"
                  : "retention-item"
              }
              onClick={() => {
                setSelectedId(item.id);
                void announce(
                  `${item.subject}. Category ${item.category}. Age ${item.ageDays} days. ${item.neverDelete ? "Protected from deletion." : "Eligible for Trash review."} Status ${item.status.replaceAll("_", " ").toLowerCase()}.`,
                );
              }}
              aria-current={item.id === selectedId ? "true" : undefined}
            >
              <span className="retention-item__subject">{item.subject}</span>
              <span className="retention-item__meta">
                {item.category} · {item.ageDays} days ·{" "}
                {item.neverDelete ? "Never delete" : "Reviewable"} ·{" "}
                {item.status.replaceAll("_", " ")}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {selected ? (
        <div className="retention-actions" role="group" aria-label="Retention actions">
          <button
            type="button"
            className="btn-primary"
            disabled={selected.status !== "CANDIDATE"}
            onClick={() => void act("keep")}
          >
            Keep
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={selected.status !== "CANDIDATE" || selected.neverDelete}
            onClick={() => void act("approve_trash")}
          >
            Approve for Trash
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

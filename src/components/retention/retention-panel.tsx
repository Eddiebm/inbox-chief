"use client";

import { useMemo, useState } from "react";
import {
  decideRetention,
  demoRetentionCandidates,
  type RetentionCandidate,
} from "@/lib/retention";
import { speak } from "@/lib/voice/speech";
import { product } from "@/lib/product";

const DEMO_SCOPE = {
  organizationId: "demo_org",
  workspaceId: "demo_ws",
  mailboxId: "demo_mb",
  userId: "demo_user",
};

export function RetentionPanel() {
  const initial = useMemo(() => demoRetentionCandidates(DEMO_SCOPE), []);
  const [items, setItems] = useState<RetentionCandidate[]>(initial);
  const [status, setStatus] = useState(
    `${product.name} never deletes protected categories. Every trash move needs your review.`,
  );
  const [selectedId, setSelectedId] = useState<string | null>(
    initial[0]?.id ?? null,
  );

  const selected = items.find((i) => i.id === selectedId) ?? null;
  const open = items.filter((i) => i.status === "CANDIDATE");

  async function announce(message: string) {
    setStatus(message);
    await speak(message);
  }

  async function act(decision: "keep" | "approve_trash") {
    if (!selected) return;
    try {
      const result = decideRetention(selected, decision, DEMO_SCOPE);
      setItems((prev) =>
        prev.map((i) => (i.id === result.item.id ? result.item : i)),
      );
      await announce(result.spoken);
    } catch (err) {
      await announce(err instanceof Error ? err.message : "Action blocked.");
    }
  }

  return (
    <div className="retention-panel">
      <header className="page-header">
        <h1>Retention center</h1>
        <p>
          Review messages past your retention window. Protected categories cannot
          be trashed. Nothing is deleted without your decision.
        </p>
      </header>

      <p className="status-line" role="status" aria-live="assertive">
        {status}
      </p>
      <p role="status">
        {open.length} candidate{open.length === 1 ? "" : "s"} waiting for review
        {open.length === 0 ? " — nothing past retention yet." : "."}
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
                setStatus(
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
      ) : null}
    </div>
  );
}

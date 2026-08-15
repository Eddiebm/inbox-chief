"use client";

import { useMemo, useState } from "react";
import { demoDrafts, updateDraft, type DraftItem } from "@/lib/drafts";
import { speak } from "@/lib/voice/speech";
import { product } from "@/lib/product";

const DEMO_SCOPE = {
  organizationId: "demo_org",
  workspaceId: "demo_ws",
  mailboxId: "demo_mb",
  userId: "demo_user",
};

export function DraftsPanel() {
  const initial = useMemo(() => demoDrafts(DEMO_SCOPE), []);
  const [items, setItems] = useState<DraftItem[]>(initial);
  const [status, setStatus] = useState(
    `${product.name} drafts for your review. Edit, discard, or send to approvals — never silent send.`,
  );
  const [selectedId, setSelectedId] = useState<string | null>(
    initial[0]?.id ?? null,
  );
  const [editBody, setEditBody] = useState(initial[0]?.bodyText ?? "");

  const selected = items.find((i) => i.id === selectedId) ?? null;
  const active = items.filter((i) => i.status !== "DISCARDED");

  async function announce(message: string) {
    setStatus(message);
    await speak(message);
  }

  function select(item: DraftItem) {
    setSelectedId(item.id);
    setEditBody(item.bodyText);
    setStatus(
      `Draft: ${item.subject}. To ${item.toAddresses.join(", ")}. Status ${item.status.replaceAll("_", " ").toLowerCase()}.`,
    );
  }

  async function act(action: "edit" | "request_approval" | "discard") {
    if (!selected) return;
    try {
      const result = updateDraft(
        selected,
        action,
        DEMO_SCOPE,
        action === "edit" ? editBody : undefined,
      );
      setItems((prev) =>
        prev.map((i) => (i.id === result.item.id ? result.item : i)),
      );
      if (action === "edit") setEditBody(result.item.bodyText);
      await announce(result.spoken);
    } catch (err) {
      await announce(err instanceof Error ? err.message : "Action blocked.");
    }
  }

  return (
    <div className="drafts-panel">
      <header className="page-header">
        <h1>Drafts</h1>
        <p>
          Review AI-prepared replies. Request approval when ready — sending still
          requires a separate confirmation on Approvals.
        </p>
      </header>

      <p className="status-line" role="status" aria-live="assertive">
        {status}
      </p>
      <p role="status">
        {active.length} active draft{active.length === 1 ? "" : "s"}
        {active.length === 0
          ? " — nothing waiting for review yet."
          : "."}
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
      ) : null}
    </div>
  );
}

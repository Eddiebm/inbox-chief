"use client";

import { useMemo, useState } from "react";
import {
  applyApprovalDecision,
  confirmSend,
  demoApprovalQueue,
  type ApprovalItem,
} from "@/lib/approvals";
import { speak } from "@/lib/voice/speech";
import { product } from "@/lib/product";

const DEMO_SCOPE = {
  organizationId: "demo_org",
  workspaceId: "demo_ws",
  mailboxId: "demo_mb",
  userId: "demo_user",
};

export function ApprovalsPanel() {
  const initial = useMemo(() => demoApprovalQueue(DEMO_SCOPE), []);
  const [items, setItems] = useState<ApprovalItem[]>(initial);
  const [status, setStatus] = useState(
    `${product.name} never sends mail until you approve, then confirm Send.`,
  );
  const [selectedId, setSelectedId] = useState<string | null>(
    initial[0]?.id ?? null,
  );

  const selected = items.find((i) => i.id === selectedId) ?? null;
  const awaiting = items.filter((i) => i.status === "AWAITING_APPROVAL");

  async function announce(message: string) {
    setStatus(message);
    await speak(message);
  }

  async function decide(decision: "approve" | "reject") {
    if (!selected) return;
    try {
      const result = applyApprovalDecision(selected, decision, DEMO_SCOPE);
      setItems((prev) =>
        prev.map((i) => (i.id === result.item.id ? result.item : i)),
      );
      await announce(result.spoken);
    } catch (err) {
      await announce(err instanceof Error ? err.message : "Decision failed.");
    }
  }

  async function sendApproved() {
    if (!selected) return;
    try {
      const result = confirmSend(selected, DEMO_SCOPE);
      setItems((prev) =>
        prev.map((i) => (i.id === result.item.id ? result.item : i)),
      );
      await announce(result.spoken);
    } catch (err) {
      await announce(err instanceof Error ? err.message : "Send blocked.");
    }
  }

  return (
    <div className="approvals-panel">
      <header className="page-header">
        <h1>Approvals</h1>
        <p>
          Review drafts before anything leaves your mailbox. Approve first, then
          confirm Send. There is no silent send path.
        </p>
      </header>

      <p className="status-line" role="status" aria-live="assertive">
        {status}
      </p>
      <p role="status">
        {awaiting.length} draft{awaiting.length === 1 ? "" : "s"} awaiting
        approval
        {awaiting.length === 0
          ? " — nothing waiting. Connect Gmail if you expected drafts."
          : "."}
      </p>

      <div className="approvals-layout">
        <ul className="approvals-list" aria-label="Drafts awaiting review">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className={
                  item.id === selectedId
                    ? "approvals-item is-selected"
                    : "approvals-item"
                }
                onClick={() => {
                  setSelectedId(item.id);
                  setStatus(
                    `Selected: ${item.subject}. Status: ${item.status.replaceAll("_", " ").toLowerCase()}.`,
                  );
                }}
                aria-current={item.id === selectedId ? "true" : undefined}
              >
                <span className="approvals-item__subject">{item.subject}</span>
                <span className="approvals-item__meta">
                  {item.status.replaceAll("_", " ")} · To{" "}
                  {item.toAddresses.join(", ")}
                </span>
              </button>
            </li>
          ))}
        </ul>

        {selected ? (
          <article
            className="approvals-detail"
            aria-labelledby="approval-detail-heading"
          >
            <h2 id="approval-detail-heading">{selected.subject}</h2>
            <p>
              <strong>To:</strong> {selected.toAddresses.join(", ")}
            </p>
            <p>
              <strong>Status:</strong>{" "}
              {selected.status.replaceAll("_", " ").toLowerCase()}
            </p>
            <pre className="approvals-body">{selected.bodyPreview}</pre>
            <div className="approvals-actions">
              <button
                type="button"
                className="btn-primary"
                disabled={selected.status !== "AWAITING_APPROVAL"}
                onClick={() => void decide("approve")}
              >
                Approve
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={selected.status !== "AWAITING_APPROVAL"}
                onClick={() => void decide("reject")}
              >
                Reject
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={selected.status !== "APPROVED"}
                onClick={() => void sendApproved()}
              >
                Confirm send
              </button>
            </div>
          </article>
        ) : null}
      </div>
    </div>
  );
}

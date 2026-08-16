"use client";

import { useEffect, useState } from "react";
import type { ApprovalItem } from "@/lib/approvals";
import { speak } from "@/lib/voice/speech";
import { product } from "@/lib/product";

export function ApprovalsPanel() {
  const [items, setItems] = useState<ApprovalItem[]>([]);
  const [status, setStatus] = useState(
    `${product.name} never sends mail until you approve, then confirm Send.`,
  );
  const [selectedId, setSelectedId] = useState<string | null>(
    null,
  );

  const selected = items.find((i) => i.id === selectedId) ?? null;
  const awaiting = items.filter((i) => i.status === "AWAITING_APPROVAL");

  useEffect(() => {
    void fetch("/api/approvals")
      .then((response) => response.json())
      .then((data: { items?: Array<Omit<ApprovalItem, "bodyPreview"> & { bodyText: string }> }) => {
        const loaded = (data.items ?? []).map((item) => ({
          ...item,
          bodyPreview: item.bodyText,
        }));
        setItems(loaded);
        setSelectedId(loaded[0]?.id ?? null);
        setStatus(
          loaded.length
            ? `${loaded.length} real draft${loaded.length === 1 ? "" : "s"} loaded. Approve first, then confirm Send.`
            : "No drafts are waiting. Nothing will be sent.",
        );
      })
      .catch(() => setStatus("Could not load approvals right now."));
  }, []);

  async function announce(message: string) {
    setStatus(message);
    await speak(message);
  }

  async function decide(decision: "approve" | "reject") {
    if (!selected) return;
    try {
      const response = await fetch("/api/approvals", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: selected.id, action: decision }),
      });
      if (!response.ok) throw new Error("The draft changed. Reload and try again.");
      const nextStatus: ApprovalItem["status"] =
        decision === "approve" ? "APPROVED" : "REJECTED";
      setItems((prev) =>
        prev.map((i) => (i.id === selected.id ? { ...i, status: nextStatus } : i)),
      );
      await announce(
        decision === "approve"
          ? `Approved ${selected.subject}. Review it once more, then choose Confirm send. Nothing has been sent yet.`
          : `Rejected ${selected.subject}. It will not be sent.`,
      );
    } catch (err) {
      await announce(err instanceof Error ? err.message : "Decision failed.");
    }
  }

  async function sendApproved() {
    if (!selected) return;
    try {
      const response = await fetch("/api/approvals", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: selected.id, action: "confirm_send" }),
      });
      const data = (await response.json()) as { sent?: { recipient: string }; message?: string };
      if (!response.ok) throw new Error(data.message ?? "Send blocked.");
      setItems((prev) =>
        prev.map((i) => (i.id === selected.id ? { ...i, status: "SENT" } : i)),
      );
      await announce(`Sent to ${data.sent?.recipient ?? selected.toAddresses.join(", ")}.`);
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

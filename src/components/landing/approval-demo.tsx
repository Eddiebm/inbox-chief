"use client";

import { useId, useRef, useState } from "react";

type Status = "pending" | "approved" | "held";

const ORIGINAL =
  "Thursday works. I’ll send the updated timeline this afternoon so we can review it together before launch.";

const LOG_TEXT: Record<Status, string> = {
  pending: "Drafted a reply to Alex. Waiting for you.",
  approved: "You approved the reply. It was sent.",
  held: "You held the reply. It stays in drafts.",
};

export function ApprovalDemo() {
  const draftId = useId();
  const logId = useId();
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const [status, setStatus] = useState<Status>("pending");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(ORIGINAL);
  const [edited, setEdited] = useState(false);
  const [log, setLog] = useState<string[]>([LOG_TEXT.pending]);

  const sent = status === "approved" ? 1 : 0;

  function push(line: string) {
    setLog((prev) => [...prev, line]);
  }

  function approve() {
    setEditing(false);
    setStatus("approved");
    push(edited ? "You edited the draft, then approved it. It was sent." : LOG_TEXT.approved);
  }

  function hold() {
    setEditing(false);
    setStatus("held");
    push(LOG_TEXT.held);
  }

  function startEdit() {
    setEditing(true);
    requestAnimationFrame(() => editorRef.current?.focus());
  }

  function saveEdit() {
    setEditing(false);
    if (draft !== ORIGINAL) {
      setEdited(true);
      push("You changed the wording. Still waiting for approval.");
    }
  }

  function reset() {
    setStatus("pending");
    setEditing(false);
    setDraft(ORIGINAL);
    setEdited(false);
    setLog([LOG_TEXT.pending]);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (editing || status !== "pending") return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === "a") approve();
    else if (key === "e") startEdit();
    else if (key === "h") hold();
  }

  return (
    <div className="demo" onKeyDown={onKeyDown}>
      <div className="demo__counter">
        <span className="demo__counter-n" data-sent={sent > 0}>
          {sent}
        </span>
        <span className="demo__counter-label">
          {sent === 0
            ? "messages sent without your approval"
            : "message sent, because you approved it"}
        </span>
      </div>

      <div className="demo__mail">
        <p className="demo__from">
          <strong>Alex Rivera</strong> · Project timeline
        </p>
        <p className="demo__quote">
          Can we confirm the Thursday review before Friday’s launch?
        </p>

        <div className="demo__draft" data-status={status}>
          <p className="demo__draft-label" id={draftId}>
            {status === "pending" && "Draft ready. Not sent."}
            {status === "approved" && "Sent"}
            {status === "held" && "On hold. Not sent."}
          </p>
          {editing ? (
            <textarea
              ref={editorRef}
              className="demo__editor"
              aria-labelledby={draftId}
              value={draft}
              rows={4}
              onChange={(e) => setDraft(e.target.value)}
            />
          ) : (
            <p className="demo__draft-text">{draft}</p>
          )}

          {status === "pending" ? (
            <div className="demo__actions">
              {editing ? (
                <button type="button" className="demo__btn demo__btn--main" onClick={saveEdit}>
                  Save changes
                </button>
              ) : (
                <>
                  <button type="button" className="demo__btn demo__btn--main" onClick={approve}>
                    Approve <kbd>A</kbd>
                  </button>
                  <button type="button" className="demo__btn" onClick={startEdit}>
                    Edit <kbd>E</kbd>
                  </button>
                  <button type="button" className="demo__btn" onClick={hold}>
                    Hold <kbd>H</kbd>
                  </button>
                </>
              )}
            </div>
          ) : (
            <div className="demo__actions">
              <button type="button" className="demo__btn" onClick={reset}>
                Try it again
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="demo__log">
        <p className="demo__log-title" id={logId}>
          What your assistant did
        </p>
        <ol aria-labelledby={logId} aria-live="polite">
          {log.map((line, i) => (
            <li key={`${i}-${line}`}>{line}</li>
          ))}
        </ol>
      </div>
    </div>
  );
}

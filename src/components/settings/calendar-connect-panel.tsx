"use client";

import { useEffect, useState } from "react";

export function CalendarConnectPanel() {
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState("Checking Calendar connection…");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("calendar") === "connected") {
      setConnected(true);
      setStatus("Calendar connected for read-only call access.");
      return;
    }
    void fetch("/api/calendar/status")
      .then((response) => response.json())
      .then((data: { connected?: boolean; timeZone?: string | null }) => {
        setConnected(Boolean(data.connected));
        setStatus(
          data.connected
            ? `Calendar is connected${data.timeZone ? ` in ${data.timeZone}` : ""}.`
            : "Calendar is not connected. Email still works without it.",
        );
      })
      .catch(() => setStatus("Could not check Calendar right now."));
  }, []);

  async function connect() {
    setBusy(true);
    setStatus("Starting optional Google Calendar connection…");
    try {
      const response = await fetch("/api/calendar/connect", { method: "POST" });
      const data = (await response.json()) as { url?: string; message?: string };
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      setStatus(data.message ?? "Could not start Calendar connection.");
    } catch {
      setStatus("Could not start Calendar connection.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-block" aria-labelledby="calendar-connect-heading">
      <h2 id="calendar-connect-heading">Optional: Connect Calendar</h2>
      <p>
        This is a separate Google approval for read-only calendar access. Inbox
        Chief can speak today, tomorrow, or your next event. It cannot create or
        change events.
      </p>
      <p className="status-line" role="status" aria-live="polite">
        {status}
      </p>
      <button
        type="button"
        className="btn-primary"
        disabled={busy || connected}
        aria-busy={busy}
        onClick={() => void connect()}
      >
        {connected ? "Calendar connected" : busy ? "Connecting…" : "Connect Calendar"}
      </button>
    </section>
  );
}

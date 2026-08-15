import { describe, expect, it } from "vitest";
import { speakReceivedAt } from "@/lib/call-in/speak-received";
import { demoInbox, triageMessage } from "@/lib/inbox";

const scope = {
  organizationId: "demo_org",
  workspaceId: "demo_ws",
  mailboxId: "demo_mb",
  userId: "u1",
};

describe("inbox triage", () => {
  it("triages, defers, and archives with spoken outcomes", () => {
    const [item] = demoInbox(scope);
    expect(triageMessage(item!, "mark_triaged", scope).item.status).toBe(
      "TRIAGED",
    );
    expect(triageMessage(item!, "defer", scope).item.status).toBe("DEFERRED");
    expect(triageMessage(item!, "archive", scope).item.status).toBe("ARCHIVED");
  });

  it("demo inbox items have received timestamps for spoken selection", () => {
    const [item] = demoInbox(scope);
    expect(item?.receivedAt).toBeTruthy();
    const spoken = speakReceivedAt(item!.receivedAt, "America/Chicago", new Date("2026-08-13T12:00:00-05:00"));
    expect(spoken).toMatch(/Received/i);
    expect(spoken).toMatch(/3:41/i);
  });

  it("blocks cross-tenant triage", () => {
    const [item] = demoInbox(scope);
    expect(() =>
      triageMessage(item!, "mark_triaged", {
        ...scope,
        organizationId: "other",
      }),
    ).toThrow(/cross-tenant/i);
  });
});

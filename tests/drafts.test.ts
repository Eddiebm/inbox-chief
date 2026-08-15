import { describe, expect, it } from "vitest";
import { demoDrafts, updateDraft } from "@/lib/drafts";

const scope = {
  organizationId: "demo_org",
  workspaceId: "demo_ws",
  mailboxId: "demo_mb",
  userId: "u1",
};

describe("drafts", () => {
  it("edits, requests approval, and discards without sending", () => {
    const [draft] = demoDrafts(scope);
    expect(updateDraft(draft!, "edit", scope, "Edited body").item.status).toBe(
      "EDITING",
    );
    expect(updateDraft(draft!, "request_approval", scope).item.status).toBe(
      "AWAITING_APPROVAL",
    );
    expect(updateDraft(draft!, "discard", scope).item.status).toBe("DISCARDED");
  });

  it("blocks cross-tenant draft updates", () => {
    const [draft] = demoDrafts(scope);
    expect(() =>
      updateDraft(draft!, "discard", { ...scope, organizationId: "other" }),
    ).toThrow(/cross-tenant/i);
  });
});

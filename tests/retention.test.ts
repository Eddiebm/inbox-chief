import { describe, expect, it } from "vitest";
import { decideRetention, demoRetentionCandidates } from "@/lib/retention";

const scope = {
  organizationId: "demo_org",
  workspaceId: "demo_ws",
  mailboxId: "demo_mb",
  userId: "u1",
};

describe("retention center", () => {
  it("blocks trash for never-delete categories", () => {
    const protectedItem = demoRetentionCandidates(scope).find((i) => i.neverDelete);
    expect(protectedItem).toBeTruthy();
    expect(() =>
      decideRetention(protectedItem!, "approve_trash", scope),
    ).toThrow(/protected/i);
  });

  it("allows keep and trash for eligible items", () => {
    const eligible = demoRetentionCandidates(scope).find((i) => !i.neverDelete)!;
    expect(decideRetention(eligible, "keep", scope).item.status).toBe("KEPT");
    expect(
      decideRetention(eligible, "approve_trash", scope).item.status,
    ).toBe("TRASH_APPROVED");
  });

  it("blocks cross-tenant retention decisions", () => {
    const [item] = demoRetentionCandidates(scope);
    expect(() =>
      decideRetention(item!, "keep", { ...scope, organizationId: "other" }),
    ).toThrow(/cross-tenant/i);
  });
});

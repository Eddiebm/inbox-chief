import { describe, expect, it } from "vitest";
import { demoFollowUps, updateFollowUp } from "@/lib/follow-ups";

const scope = {
  organizationId: "demo_org",
  workspaceId: "demo_ws",
  mailboxId: "demo_mb",
  userId: "u1",
};

describe("follow-ups", () => {
  it("completes and snoozes open items", () => {
    const [item] = demoFollowUps(scope);
    expect(updateFollowUp(item!, "complete", scope).item.status).toBe(
      "COMPLETED",
    );
    expect(updateFollowUp(item!, "snooze", scope).item.status).toBe("SNOOZED");
  });

  it("blocks cross-tenant updates", () => {
    const [item] = demoFollowUps(scope);
    expect(() =>
      updateFollowUp(item!, "complete", {
        ...scope,
        organizationId: "other",
      }),
    ).toThrow(/cross-tenant/i);
  });
});

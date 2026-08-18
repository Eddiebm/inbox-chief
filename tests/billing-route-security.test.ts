import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  resolveUserMailboxScope: vi.fn(),
  organizationMemberFindFirst: vi.fn(),
  subscriptionFindFirst: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.getCurrentUser }));

vi.mock("@/lib/mail/tenant-context", () => ({
  resolveUserMailboxScope: mocks.resolveUserMailboxScope,
}));

vi.mock("@/lib/db-node", () => ({
  getNodePrisma: () => ({
    organizationMember: { findFirst: mocks.organizationMemberFindFirst },
    subscription: { findFirst: mocks.subscriptionFindFirst },
  }),
}));

import { POST as checkoutPost } from "@/app/api/billing/checkout/route";
import { POST as portalPost } from "@/app/api/billing/portal/route";

const ORIGIN = "https://inboxchief.email";
const CHECKOUT_URL = `${ORIGIN}/api/billing/checkout`;
const PORTAL_URL = `${ORIGIN}/api/billing/portal`;

function post(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("billing routes bind the organization server-side", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("DATABASE_URL", "postgresql://unused");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    vi.stubEnv("CALL_IN_PUBLIC_BASE_URL", "");
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    mocks.getCurrentUser.mockResolvedValue({
      id: "user_1",
      email: "patron@example.com",
    });
    mocks.resolveUserMailboxScope.mockResolvedValue({
      organizationId: "org_mine",
      workspaceId: "ws_mine",
      userId: "user_1",
    });
    mocks.organizationMemberFindFirst.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("rejects a checkout that names someone else's organization", async () => {
    const response = await checkoutPost(
      post(CHECKOUT_URL, {
        minutePackKey: "pack_60",
        organizationId: "org_victim",
      }),
    );
    expect(response.status).toBe(403);
    expect(mocks.organizationMemberFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "org_victim", userId: "user_1" },
      }),
    );
  });

  it("rejects an anonymous caller naming an organization", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    const response = await checkoutPost(
      post(CHECKOUT_URL, { planKey: "pro", organizationId: "org_victim" }),
    );
    expect(response.status).toBe(401);
  });

  it("accepts a second organization the user really belongs to", async () => {
    mocks.organizationMemberFindFirst.mockResolvedValue({ id: "member_1" });
    const response = await checkoutPost(
      post(CHECKOUT_URL, {
        minutePackKey: "pack_60",
        organizationId: "org_second",
      }),
    );
    // Stripe is not configured in tests, so membership passing lands on 503.
    expect(response.status).toBe(503);
  });

  it("rejects an external successUrl", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_dummy");
    const response = await checkoutPost(
      post(CHECKOUT_URL, {
        planKey: "pro",
        successUrl: "https://evil.example.com/harvest",
      }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/successUrl/);
  });

  it("rejects an external cancelUrl", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_dummy");
    const response = await checkoutPost(
      post(CHECKOUT_URL, {
        planKey: "pro",
        cancelUrl: "https://evil.example.com/harvest",
      }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/cancelUrl/);
  });

  it("allows a same-origin successUrl", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_dummy");
    const response = await checkoutPost(
      post(CHECKOUT_URL, {
        planKey: "pro",
        successUrl: `${ORIGIN}/dashboard/billing?checkout=success`,
      }),
    );
    // No STRIPE_PRICE_* set, so this lands on the operator stub, not a 400.
    expect(response.status).toBe(200);
    expect((await response.json()).stub).toBe(true);
  });

  it("rejects a portal request for someone else's organization", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_dummy");
    const response = await portalPost(
      post(PORTAL_URL, { organizationId: "org_victim" }),
    );
    expect(response.status).toBe(403);
  });

  it("rejects an external portal returnUrl", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_dummy");
    const response = await portalPost(
      post(PORTAL_URL, { returnUrl: "https://evil.example.com/x" }),
    );
    expect(response.status).toBe(400);
  });
});

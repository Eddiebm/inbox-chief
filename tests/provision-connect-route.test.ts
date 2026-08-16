import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  findProvisioningByCode: vi.fn(),
  verifyProvisioningMagicToken: vi.fn(),
  findFirst: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  createSession: mocks.createSession,
}));

vi.mock("@/lib/db-node", () => ({
  getNodePrisma: () => ({
    provisioningRequest: { findFirst: mocks.findFirst },
  }),
}));

vi.mock("@/lib/provisioning", () => ({
  findProvisioningByCode: mocks.findProvisioningByCode,
  verifyProvisioningMagicToken: mocks.verifyProvisioningMagicToken,
}));

import { GET } from "@/app/api/provision/connect/route";

const provision = {
  id: "request_1",
  userId: "user_1",
  shortCode: "ABCD2345",
  needsGoogleTestUser: false,
  googleTestUserEnabled: true,
  provisionedReady: false,
};

const ENV_KEYS = [
  "GOOGLE_OAUTH_PUBLISHED",
  "NEXT_PUBLIC_APP_URL",
  "CALL_IN_PUBLIC_BASE_URL",
] as const;

describe("voice provisioning browser handoff", () => {
  const previousEnv = Object.fromEntries(
    ENV_KEYS.map((key) => [key, process.env[key]]),
  );

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GOOGLE_OAUTH_PUBLISHED = "false";
    // Exercise the request-origin fallback so assertions stay deterministic.
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.CALL_IN_PUBLIC_BASE_URL;
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = previousEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("redeems a signed SMS magic link and starts Gmail connect", async () => {
    mocks.verifyProvisioningMagicToken.mockResolvedValue({
      requestId: "request_1",
      userId: "user_1",
    });
    mocks.findFirst.mockResolvedValue(provision);

    const response = await GET(
      new Request("https://inbox-chief.test/api/provision/connect?token=signed"),
    );

    expect(mocks.createSession).toHaveBeenCalledWith("user_1");
    expect(response.headers.get("location")).toBe(
      "https://inbox-chief.test/api/gmail/connect?returnTo=/dashboard/settings&redirect=1",
    );
  });

  it("redeems the spoken short code and starts Gmail connect", async () => {
    mocks.findProvisioningByCode.mockResolvedValue(provision);

    const response = await GET(
      new Request("https://inbox-chief.test/api/provision/connect?code=ABCD2345"),
    );

    expect(mocks.findProvisioningByCode).toHaveBeenCalledWith("ABCD2345");
    expect(mocks.createSession).toHaveBeenCalledWith("user_1");
    expect(response.headers.get("location")).toContain("/api/gmail/connect?");
  });

  it("keeps a test user pending but removes the gate after verification", async () => {
    mocks.findProvisioningByCode.mockResolvedValue({
      ...provision,
      needsGoogleTestUser: true,
      googleTestUserEnabled: false,
    });

    const pending = await GET(
      new Request("https://inbox-chief.test/api/provision/connect?code=ABCD2345"),
    );
    expect(pending.headers.get("location")).toBe(
      "https://inbox-chief.test/provision/ABCD2345?reason=operator_pending",
    );
    expect(mocks.createSession).not.toHaveBeenCalled();

    process.env.GOOGLE_OAUTH_PUBLISHED = "true";
    const published = await GET(
      new Request("https://inbox-chief.test/api/provision/connect?code=ABCD2345"),
    );
    expect(mocks.createSession).toHaveBeenCalledWith("user_1");
    expect(published.headers.get("location")).toContain("/api/gmail/connect?");
  });
});

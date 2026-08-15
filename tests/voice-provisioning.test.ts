import { afterEach, describe, expect, it } from "vitest";
import {
  buildCallInSystemPrompt,
  buildCallInVapiTools,
  VAPI_CALL_IN_TOOL_NAMES,
} from "@/lib/call-in/vapi-tools";
import {
  signProvisioningMagicToken,
  verifyProvisioningMagicToken,
} from "@/lib/provisioning";

describe("voice provisioning", () => {
  const previousAuthSecret = process.env.AUTH_SECRET;

  afterEach(() => {
    if (previousAuthSecret === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = previousAuthSecret;
  });

  it("provides signup and status tools without a send tool", () => {
    const tools = buildCallInVapiTools("https://example.test");
    const names = tools.map((tool) => tool.function.name);

    expect(VAPI_CALL_IN_TOOL_NAMES).toContain("provision_signup");
    expect(names).toContain("provision_signup");
    expect(names).toContain("check_provision_status");
    expect(names.some((name) => /send.*email/i.test(name))).toBe(false);
  });

  it("requires Gmail spell-back and forbids attachment reads during setup", () => {
    const prompt = buildCallInSystemPrompt();
    expect(prompt).toMatch(/spell it back character by character/i);
    expect(prompt).toMatch(/explicit confirmation/i);
    expect(prompt).toMatch(/Do not read any email or attachment content during provisioning/i);
    expect(prompt).toMatch(/Primary only/i);
    expect(prompt).toMatch(/NEVER send/i);
  });

  it("signs and verifies a tenant-neutral 24-hour handoff identity", async () => {
    process.env.AUTH_SECRET = "test-provisioning-secret";
    const token = await signProvisioningMagicToken({
      requestId: "request_123",
      userId: "user_123",
    });

    await expect(verifyProvisioningMagicToken(token)).resolves.toEqual({
      requestId: "request_123",
      userId: "user_123",
    });
  });

  it("rejects a handoff signed with a different secret", async () => {
    process.env.AUTH_SECRET = "first-secret";
    const token = await signProvisioningMagicToken({
      requestId: "request_123",
      userId: "user_123",
    });
    process.env.AUTH_SECRET = "second-secret";

    await expect(verifyProvisioningMagicToken(token)).rejects.toThrow();
  });
});

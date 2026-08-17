import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as twilioVoicePost } from "@/app/api/call-in/twilio/voice/route";
import {
  computeTwilioSignature,
  isTwilioConfigured,
  verifyTwilioRequest,
} from "@/lib/call-in/twilio-signature";
import {
  isVapiWebhookAuthConfigured,
  verifyVapiWebhookSecret,
} from "@/lib/call-in/vapi-webhook";
import {
  describeInsecureSecrets,
  findInsecureProductionSecrets,
} from "@/lib/security/env-guard";
import { FailureRateLimiter } from "@/lib/security/rate-limit";
import { sameOriginRedirect } from "@/lib/security/redirects";
import { redactPhone, secretsMatch } from "@/lib/security/secrets";

function headersWith(values: Record<string, string>): Headers {
  return new Headers(values);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("VAPI webhook authentication", () => {
  it("rejects in production when VAPI_WEBHOOK_SECRET is missing", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("MOCK_INTEGRATIONS", "");
    vi.stubEnv("VAPI_WEBHOOK_SECRET", "");

    const result = verifyVapiWebhookSecret(headersWith({}));
    expect(result).toMatchObject({ ok: false, status: 401 });
  });

  it("rejects in production even when the caller sends some secret", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("MOCK_INTEGRATIONS", "");
    vi.stubEnv("VAPI_WEBHOOK_SECRET", "");

    const result = verifyVapiWebhookSecret(
      headersWith({ "x-vapi-secret": "anything" }),
    );
    expect(result).toMatchObject({ ok: false, status: 401 });
  });

  it("treats the dev placeholder as unconfigured in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("MOCK_INTEGRATIONS", "");
    vi.stubEnv("VAPI_WEBHOOK_SECRET", "dev-only-change-me");

    expect(isVapiWebhookAuthConfigured()).toBe(false);
    expect(
      verifyVapiWebhookSecret(
        headersWith({ "x-vapi-secret": "dev-only-change-me" }),
      ),
    ).toMatchObject({ ok: false, status: 401 });
  });

  it("rejects a wrong secret", () => {
    vi.stubEnv("VAPI_WEBHOOK_SECRET", "correct-horse-battery-staple");

    expect(
      verifyVapiWebhookSecret(headersWith({ "x-vapi-secret": "wrong" })),
    ).toMatchObject({ ok: false, status: 401 });
    expect(verifyVapiWebhookSecret(headersWith({}))).toMatchObject({
      ok: false,
      status: 401,
    });
  });

  it("accepts the configured secret on either header", () => {
    vi.stubEnv("VAPI_WEBHOOK_SECRET", "correct-horse-battery-staple");

    expect(
      verifyVapiWebhookSecret(
        headersWith({ "x-vapi-secret": "correct-horse-battery-staple" }),
      ),
    ).toEqual({ ok: true });
    expect(
      verifyVapiWebhookSecret(
        headersWith({ "x-webhook-secret": "correct-horse-battery-staple" }),
      ),
    ).toEqual({ ok: true });
    expect(isVapiWebhookAuthConfigured()).toBe(true);
  });

  it("stays permissive for local development without a secret", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("VAPI_WEBHOOK_SECRET", "");
    expect(verifyVapiWebhookSecret(headersWith({}))).toEqual({ ok: true });
  });

  it("compares secrets without leaking length", () => {
    expect(secretsMatch("abc", "abc")).toBe(true);
    expect(secretsMatch("abc", "abcd")).toBe(false);
    expect(secretsMatch("", "abc")).toBe(false);
  });
});

describe("Twilio voice webhook signature validation", () => {
  const params = { From: "+14055106989", CallSid: "CA123" };
  const url = "https://inbox-chief.test/api/call-in/twilio/voice";

  beforeEach(() => {
    vi.stubEnv("CALL_IN_PUBLIC_BASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
  });

  it("accepts a correctly signed request", () => {
    vi.stubEnv("TWILIO_AUTH_TOKEN", "token_abc");
    const signature = computeTwilioSignature("token_abc", url, params);
    expect(verifyTwilioRequest({ url, signature, params })).toEqual({ ok: true });
  });

  it("rejects a bad signature", () => {
    vi.stubEnv("TWILIO_AUTH_TOKEN", "token_abc");
    expect(
      verifyTwilioRequest({ url, signature: "not-a-signature", params }),
    ).toMatchObject({ ok: false, status: 403 });
  });

  it("rejects a signature computed over tampered params", () => {
    vi.stubEnv("TWILIO_AUTH_TOKEN", "token_abc");
    const signature = computeTwilioSignature("token_abc", url, params);
    expect(
      verifyTwilioRequest({
        url,
        signature,
        params: { ...params, From: "+15550001111" },
      }),
    ).toMatchObject({ ok: false, status: 403 });
  });

  it("rejects a missing signature header", () => {
    vi.stubEnv("TWILIO_AUTH_TOKEN", "token_abc");
    expect(verifyTwilioRequest({ url, signature: null, params })).toMatchObject({
      ok: false,
      status: 403,
    });
  });

  it("locks the endpoint in production when no auth token is configured", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("MOCK_INTEGRATIONS", "");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "");
    expect(isTwilioConfigured()).toBe(false);
    expect(verifyTwilioRequest({ url, signature: null, params })).toMatchObject({
      ok: false,
      status: 403,
    });
  });

  it("route refuses an unsigned POST", async () => {
    vi.stubEnv("TWILIO_AUTH_TOKEN", "token_abc");
    const response = await twilioVoicePost(
      new Request(url, {
        method: "POST",
        body: new URLSearchParams(params),
      }),
    );
    expect(response.status).toBe(403);
  });

  it("route serves TwiML for a correctly signed POST", async () => {
    vi.stubEnv("TWILIO_AUTH_TOKEN", "token_abc");
    vi.stubEnv("MOCK_INTEGRATIONS", "true");
    const signature = computeTwilioSignature("token_abc", url, params);
    const response = await twilioVoicePost(
      new Request(url, {
        method: "POST",
        headers: { "x-twilio-signature": signature },
        body: new URLSearchParams(params),
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("<Response>");
  });
});

describe("production secret guard", () => {
  it("flags a missing AUTH_SECRET", () => {
    const problems = findInsecureProductionSecrets({} as NodeJS.ProcessEnv);
    expect(problems).toContainEqual({ name: "AUTH_SECRET", reason: "missing" });
    expect(problems).toContainEqual({
      name: "TOKEN_ENCRYPTION_KEY",
      reason: "missing",
    });
    expect(describeInsecureSecrets(problems)).toMatch(/Refusing to start/);
  });

  it("flags the development placeholder", () => {
    const problems = findInsecureProductionSecrets({
      AUTH_SECRET: "dev-only-change-me",
    } as NodeJS.ProcessEnv);
    expect(problems).toContainEqual({
      name: "AUTH_SECRET",
      reason: "placeholder",
    });
  });

  it("accepts a real AUTH_SECRET with the token key falling back to it", () => {
    expect(
      findInsecureProductionSecrets({
        AUTH_SECRET: "8f2c1b9a0d4e6f7a8b9c0d1e2f3a4b5c",
      } as NodeJS.ProcessEnv),
    ).toEqual([]);
  });

  it("flags a placeholder TOKEN_ENCRYPTION_KEY even with a good AUTH_SECRET", () => {
    expect(
      findInsecureProductionSecrets({
        AUTH_SECRET: "8f2c1b9a0d4e6f7a8b9c0d1e2f3a4b5c",
        TOKEN_ENCRYPTION_KEY: "dev-only-change-me",
      } as NodeJS.ProcessEnv),
    ).toContainEqual({ name: "TOKEN_ENCRYPTION_KEY", reason: "placeholder" });
  });
});

describe("same-origin redirect allowlist", () => {
  const origin = "https://inbox-chief-kappa.vercel.app";

  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    vi.stubEnv("CALL_IN_PUBLIC_BASE_URL", "");
  });

  it("allows same-origin absolute and relative paths", () => {
    expect(sameOriginRedirect(`${origin}/dashboard/billing`, origin)).toBe(
      `${origin}/dashboard/billing`,
    );
    expect(sameOriginRedirect("/dashboard/billing?x=1", origin)).toBe(
      `${origin}/dashboard/billing?x=1`,
    );
  });

  it("rejects external origins and non-http schemes", () => {
    expect(sameOriginRedirect("https://evil.example.com/steal", origin)).toBeNull();
    expect(
      sameOriginRedirect(`https://inbox-chief-kappa.vercel.app.evil.com/x`, origin),
    ).toBeNull();
    expect(sameOriginRedirect("javascript:alert(1)", origin)).toBeNull();
    expect(sameOriginRedirect("//evil.example.com/x", origin)).toBeNull();
  });

  it("allows the configured public app URL", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.inboxchief.com");
    expect(
      sameOriginRedirect("https://app.inboxchief.com/dashboard", origin),
    ).toBe("https://app.inboxchief.com/dashboard");
  });
});

describe("short-code failure limiter", () => {
  it("locks out after the configured number of failures", () => {
    let now = 0;
    const limiter = new FailureRateLimiter({
      maxFailures: 3,
      windowMs: 60_000,
      lockoutMs: 300_000,
      now: () => now,
    });

    expect(limiter.check("1.2.3.4")).toEqual({ allowed: true });
    limiter.recordFailure("1.2.3.4");
    limiter.recordFailure("1.2.3.4");
    expect(limiter.check("1.2.3.4")).toEqual({ allowed: true });

    limiter.recordFailure("1.2.3.4");
    const blocked = limiter.check("1.2.3.4");
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) expect(blocked.retryAfterSeconds).toBe(300);

    // Other clients are unaffected.
    expect(limiter.check("5.6.7.8")).toEqual({ allowed: true });

    now += 300_001;
    expect(limiter.check("1.2.3.4")).toEqual({ allowed: true });
  });

  it("clears the counter on a successful redemption", () => {
    const limiter = new FailureRateLimiter({
      maxFailures: 2,
      windowMs: 60_000,
      lockoutMs: 60_000,
    });
    limiter.recordFailure("ip");
    limiter.recordSuccess("ip");
    limiter.recordFailure("ip");
    expect(limiter.check("ip")).toEqual({ allowed: true });
  });
});

describe("identity log redaction", () => {
  it("keeps only the last four digits of a phone number", () => {
    expect(redactPhone("+14055106989")).toBe("***6989");
    expect(redactPhone(null)).toBe("none");
  });
});

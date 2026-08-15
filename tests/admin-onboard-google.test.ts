import { afterEach, describe, expect, it } from "vitest";
import { googleAppPublished } from "@/lib/admin/onboard-patron";

describe("admin onboard Google publish gate", () => {
  const prev = process.env.GOOGLE_OAUTH_PUBLISHED;

  afterEach(() => {
    if (prev === undefined) delete process.env.GOOGLE_OAUTH_PUBLISHED;
    else process.env.GOOGLE_OAUTH_PUBLISHED = prev;
  });

  it("reads GOOGLE_OAUTH_PUBLISHED flag", () => {
    process.env.GOOGLE_OAUTH_PUBLISHED = "true";
    expect(googleAppPublished()).toBe(true);
    process.env.GOOGLE_OAUTH_PUBLISHED = "false";
    expect(googleAppPublished()).toBe(false);
  });
});

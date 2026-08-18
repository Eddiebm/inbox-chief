import { afterEach, describe, expect, it } from "vitest";
import {
  GOOGLE_CLOUD_PROJECT_ID_PLACEHOLDER,
  googleOAuthAudienceUrl,
  getGoogleCloudProjectId,
} from "@/lib/google-oauth-console";

describe("google-oauth-console", () => {
  const prevPublic = process.env.NEXT_PUBLIC_GOOGLE_CLOUD_PROJECT_ID;
  const prevServer = process.env.GOOGLE_CLOUD_PROJECT_ID;

  afterEach(() => {
    if (prevPublic === undefined) {
      delete process.env.NEXT_PUBLIC_GOOGLE_CLOUD_PROJECT_ID;
    } else {
      process.env.NEXT_PUBLIC_GOOGLE_CLOUD_PROJECT_ID = prevPublic;
    }
    if (prevServer === undefined) {
      delete process.env.GOOGLE_CLOUD_PROJECT_ID;
    } else {
      process.env.GOOGLE_CLOUD_PROJECT_ID = prevServer;
    }
  });

  it("defaults to placeholder when env unset", () => {
    delete process.env.NEXT_PUBLIC_GOOGLE_CLOUD_PROJECT_ID;
    delete process.env.GOOGLE_CLOUD_PROJECT_ID;
    expect(getGoogleCloudProjectId()).toBe(GOOGLE_CLOUD_PROJECT_ID_PLACEHOLDER);
    expect(googleOAuthAudienceUrl()).toBe(
      "https://console.cloud.google.com/auth/audience?project=YOUR_PROJECT_ID",
    );
  });

  it("prefers NEXT_PUBLIC over server project id", () => {
    process.env.NEXT_PUBLIC_GOOGLE_CLOUD_PROJECT_ID = "inbox-chief-oauth";
    process.env.GOOGLE_CLOUD_PROJECT_ID = "other";
    expect(getGoogleCloudProjectId()).toBe("inbox-chief-oauth");
  });
});

import { afterEach, describe, expect, it } from "vitest";
import {
  isAcceptableSessionCookie,
  isMockSessionToken,
} from "@/lib/session-cookie";

describe("session cookie acceptance", () => {
  const prev = process.env.MOCK_INTEGRATIONS;

  afterEach(() => {
    process.env.MOCK_INTEGRATIONS = prev;
  });

  it("rejects short cookies", () => {
    expect(isAcceptableSessionCookie("short")).toBe(false);
    expect(isAcceptableSessionCookie(null)).toBe(false);
  });

  it("rejects mock cookies when MOCK_INTEGRATIONS is false", () => {
    process.env.MOCK_INTEGRATIONS = "false";
    const mock = `mock.${"a".repeat(40)}`;
    expect(isMockSessionToken(mock)).toBe(true);
    expect(isAcceptableSessionCookie(mock)).toBe(false);
  });

  it("accepts mock cookies only while MOCK_INTEGRATIONS is true", () => {
    process.env.MOCK_INTEGRATIONS = "true";
    const mock = `mock.${"a".repeat(40)}`;
    expect(isAcceptableSessionCookie(mock)).toBe(true);
  });

  it("accepts real session tokens when mock mode is off", () => {
    process.env.MOCK_INTEGRATIONS = "false";
    expect(isAcceptableSessionCookie("a".repeat(64))).toBe(true);
  });
});

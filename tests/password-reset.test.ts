import { describe, expect, it } from "vitest";
import {
  createPasswordResetToken,
  verifyPasswordResetToken,
} from "@/lib/auth/password-reset";

describe("password reset tokens", () => {
  it("round-trips a valid token", () => {
    const token = createPasswordResetToken("user_abc", "eddie@example.com");
    expect(verifyPasswordResetToken(token)).toEqual({
      userId: "user_abc",
      email: "eddie@example.com",
    });
  });

  it("rejects tampered and garbage tokens", () => {
    const token = createPasswordResetToken("user_abc", "eddie@example.com");
    const flipped = `${token.slice(0, 8)}AAAA${token.slice(12)}`;
    expect(verifyPasswordResetToken(flipped)).toBeNull();
    expect(verifyPasswordResetToken(`${token}x`)).toBeNull();
    expect(verifyPasswordResetToken("not-a-token")).toBeNull();
    expect(verifyPasswordResetToken("")).toBeNull();
  });
});

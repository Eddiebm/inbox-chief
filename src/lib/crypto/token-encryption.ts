import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import {
  DEV_PLACEHOLDER_SECRET,
  isPlaceholderSecret,
  isProductionRuntime,
} from "@/lib/security/secrets";

const PREFIX = "v1";

function encryptionKey(): Buffer {
  const configured =
    process.env.TOKEN_ENCRYPTION_KEY?.trim() ||
    process.env.AUTH_SECRET?.trim();
  if (isProductionRuntime() && isPlaceholderSecret(configured)) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY / AUTH_SECRET is missing or still the development placeholder — mailbox tokens would be readable by anyone with the source.",
    );
  }
  return createHash("sha256")
    .update(configured || DEV_PLACEHOLDER_SECRET)
    .digest();
}

/** Encrypt a secret string for at-rest storage (AES-256-GCM). */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    PREFIX,
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(":");
}

/** Decrypt a value produced by encryptSecret. */
export function decryptSecret(payload: string): string {
  const [version, ivB64, tagB64, dataB64] = payload.split(":");
  if (version !== PREFIX || !ivB64 || !tagB64 || !dataB64) {
    throw new Error("Invalid encrypted token payload");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(ivB64, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64url")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

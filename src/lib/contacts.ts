import type { PrismaClient } from "@/generated/prisma/client";

export type ContactCandidate = {
  id: string;
  email: string;
  displayName: string | null;
  nickname: string | null;
};

export type ContactResolution =
  | { kind: "resolved"; contact: ContactCandidate }
  | { kind: "ambiguous"; candidates: ContactCandidate[] }
  | { kind: "not_found" };

export function parseMailboxAddress(raw: string): {
  email: string;
  displayName: string | null;
} | null {
  const trimmed = raw.trim();
  const angle = trimmed.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/);
  const email = (angle?.[2] ?? trimmed).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  const displayName = angle?.[1]?.trim() || null;
  return { email, displayName };
}

function normalized(value: string | null): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}@.\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function resolveContact(
  query: string,
  contacts: ContactCandidate[],
): ContactResolution {
  const wanted = normalized(query);
  if (!wanted) return { kind: "not_found" };
  const exact = contacts.filter((contact) =>
    [contact.email, contact.displayName, contact.nickname]
      .map(normalized)
      .includes(wanted),
  );
  if (exact.length === 1) return { kind: "resolved", contact: exact[0]! };
  if (exact.length > 1) return { kind: "ambiguous", candidates: exact };

  const partial = contacts.filter((contact) =>
    [contact.displayName, contact.nickname, contact.email.split("@")[0] ?? ""]
      .map(normalized)
      .some((value) => value && value.includes(wanted)),
  );
  if (partial.length === 1) return { kind: "resolved", contact: partial[0]! };
  if (partial.length > 1) return { kind: "ambiguous", candidates: partial };
  return { kind: "not_found" };
}

export function speakContactCandidates(candidates: ContactCandidate[]): string {
  return candidates
    .slice(0, 5)
    .map((contact) => `${contact.displayName || contact.nickname || contact.email}, ${contact.email}`)
    .join("; ");
}

export async function upsertDerivedContacts(input: {
  prisma: Pick<PrismaClient, "contact">;
  organizationId: string;
  workspaceId: string;
  mailboxId: string;
  addresses: Array<{ fromAddress: string; receivedAt?: string | null }>;
}): Promise<void> {
  for (const row of input.addresses) {
    const parsed = parseMailboxAddress(row.fromAddress);
    if (!parsed) continue;
    const lastSeenAt = row.receivedAt ? new Date(row.receivedAt) : new Date();
    await input.prisma.contact.upsert({
      where: {
        mailboxId_email: { mailboxId: input.mailboxId, email: parsed.email },
      },
      create: {
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        mailboxId: input.mailboxId,
        email: parsed.email,
        displayName: parsed.displayName,
        lastSeenAt,
      },
      update: {
        ...(parsed.displayName ? { displayName: parsed.displayName } : {}),
        lastSeenAt,
      },
    });
  }
}

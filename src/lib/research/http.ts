import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getNodePrisma } from "@/lib/db-node";
import { resolveUserMailboxScope } from "@/lib/mail/tenant-context";
import type { ResearchScope } from "@/lib/research/types";

export async function requireResearchScope(): Promise<
  | { ok: true; scope: ResearchScope }
  | { ok: false; response: NextResponse }
> {
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, response: NextResponse.json({ ok: false, reason: "authentication_required", spoken: "Sign in with your own account before using the research agent." }, { status: 401 }) };
  }
  if (user.id === "mock_user") {
    return {
      ok: false,
      response: NextResponse.json({
        ok: false,
        reason: "account_required",
        spoken: "This demo session cannot save research. Sign in with the account that belongs to you.",
      }, { status: 403 }),
    };
  }
  const mailboxScope = await resolveUserMailboxScope(user.id);
  if (!mailboxScope) {
    return {
      ok: false,
      response: NextResponse.json({
        ok: false,
        reason: "workspace_required",
        spoken: "This account is not set up with its own workspace yet. Someone with maintainer access has to finish account setup. I cannot save research until then.",
      }, { status: 403 }),
    };
  }
  const mailbox = await getNodePrisma().mailbox.findFirst({
    where: { organizationId: mailboxScope.organizationId, workspaceId: mailboxScope.workspaceId, ownerId: user.id },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return {
    ok: true,
    scope: {
      organizationId: mailboxScope.organizationId,
      workspaceId: mailboxScope.workspaceId,
      userId: user.id,
      email: user.email,
      mailboxId: mailbox?.id ?? null,
    },
  };
}

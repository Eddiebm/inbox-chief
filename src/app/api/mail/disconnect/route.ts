import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth";
import { getDecryptedMailboxTokensForTenant } from "@/lib/gmail/tokens";
import { getNodePrisma } from "@/lib/db-node";
import { resolveUserMailboxScope } from "@/lib/mail/tenant-context";

const schema = z.object({ mailboxId: z.string().min(1) });

export async function DELETE(request: Request) {
  const user = await getCurrentUser();
  if (!user || user.id === "mock_user") {
    return NextResponse.json({ ok: false, message: "Sign in to disconnect a mailbox." }, { status: 401 });
  }
  const scope = await resolveUserMailboxScope(user.id);
  if (!scope) {
    return NextResponse.json({ ok: false, message: "Mailbox access is unavailable." }, { status: 403 });
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: "Choose a mailbox to disconnect." }, { status: 400 });
  }

  const prisma = getNodePrisma();
  const mailbox = await prisma.mailbox.findFirst({
    where: {
      id: parsed.data.mailboxId,
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      ownerId: user.id,
    },
    select: { id: true, emailAddress: true, provider: true },
  });
  if (!mailbox) {
    return NextResponse.json({ ok: false, message: "Mailbox not found." }, { status: 404 });
  }

  if (mailbox.provider === "gmail") {
    const tokens = await getDecryptedMailboxTokensForTenant({
      ...scope,
      mailboxId: mailbox.id,
    });
    const token = tokens?.refreshToken || tokens?.accessToken;
    if (token) {
      try {
        await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          signal: AbortSignal.timeout(5_000),
        });
      } catch (error) {
        console.warn("[mail] Google token revocation failed; clearing local credentials", {
          mailboxId: mailbox.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  await prisma.$transaction([
    prisma.mailboxOAuthToken.deleteMany({
      where: {
        organizationId: scope.organizationId,
        workspaceId: scope.workspaceId,
        mailboxId: mailbox.id,
      },
    }),
    prisma.mailboxImapCredentials.deleteMany({
      where: {
        organizationId: scope.organizationId,
        workspaceId: scope.workspaceId,
        mailboxId: mailbox.id,
      },
    }),
    prisma.mailbox.updateMany({
      where: {
        id: mailbox.id,
        organizationId: scope.organizationId,
        workspaceId: scope.workspaceId,
        ownerId: user.id,
      },
      data: {
        connectionStatus: "disconnected",
        gmailHistoryId: null,
        syncCursor: null,
      },
    }),
  ]);
  await writeAuditLog({
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
    mailboxId: mailbox.id,
    actorId: user.id,
    action: "MANAGE_INTEGRATION",
    resourceType: "mailbox",
    resourceId: mailbox.id,
    summary: `Disconnected ${mailbox.provider} mailbox ${mailbox.emailAddress}`,
  });

  return NextResponse.json({
    ok: true,
    message: `${mailbox.emailAddress} is disconnected. Sync and call-in reading have stopped.`,
  });
}

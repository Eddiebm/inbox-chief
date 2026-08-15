import { randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import {
  normalizePhoneE164,
  phoneE164Candidates,
} from "@/lib/call-in/identity";

const MAGIC_LINK_TTL_SECONDS = 24 * 60 * 60;
const SHORT_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export type ProvisioningStatus =
  | "needs_google_test_user"
  | "ready_for_google"
  | "needs_google_consent"
  | "connected";

export type ProvisionSignupInput = {
  gmail: string;
  phoneE164: string;
  preferredName?: string | null;
};

export type ProvisionSignupResult = {
  requestId: string;
  userId: string;
  phoneE164: string;
  gmail: string;
  shortCode: string;
  magicLink: string;
  provisionUrl: string;
  status: ProvisioningStatus;
  created: boolean;
};

type ProvisioningMagicPayload = {
  requestId: string;
  userId: string;
};

function appBaseUrl(): string {
  return (
    process.env.CALL_IN_PUBLIC_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    "https://inbox-chief-kappa.vercel.app"
  ).replace(/\/$/, "");
}

function tokenSecret(): Uint8Array {
  const value =
    process.env.AUTH_SECRET?.trim() ||
    process.env.TOKEN_ENCRYPTION_KEY?.trim();
  if (!value) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("provisioning_secret_missing");
    }
    return new TextEncoder().encode("dev-only-change-me");
  }
  return new TextEncoder().encode(value);
}

function createShortCode(): string {
  const bytes = randomBytes(8);
  return Array.from(bytes, (byte) => SHORT_CODE_ALPHABET[byte % SHORT_CODE_ALPHABET.length])
    .join("");
}

function normalizeGmail(value: string): string {
  const gmail = value.trim().toLowerCase();
  if (!/^[^\s@]+@gmail\.com$/i.test(gmail)) throw new Error("invalid_gmail");
  return gmail;
}

function provisioningStatus(row: {
  needsGoogleTestUser: boolean;
  googleTestUserEnabled: boolean;
  provisionedReady: boolean;
}): ProvisioningStatus {
  if (row.provisionedReady) return "connected";
  if (row.needsGoogleTestUser && !row.googleTestUserEnabled) {
    return "needs_google_test_user";
  }
  return "needs_google_consent";
}

export async function signProvisioningMagicToken(
  payload: ProvisioningMagicPayload,
): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAGIC_LINK_TTL_SECONDS}s`)
    .setAudience("provision-connect")
    .setIssuer("inbox-chief")
    .sign(tokenSecret());
}

export async function verifyProvisioningMagicToken(
  token: string,
): Promise<ProvisioningMagicPayload> {
  const { payload } = await jwtVerify(token, tokenSecret(), {
    audience: "provision-connect",
    issuer: "inbox-chief",
  });
  const requestId = String(payload.requestId ?? "");
  const userId = String(payload.userId ?? "");
  if (!requestId || !userId) throw new Error("invalid_provisioning_token");
  return { requestId, userId };
}

async function linksForRequest(input: {
  id: string;
  userId: string;
  shortCode: string;
}) {
  const token = await signProvisioningMagicToken({
    requestId: input.id,
    userId: input.userId,
  });
  const base = appBaseUrl();
  return {
    magicLink: `${base}/api/provision/connect?token=${encodeURIComponent(token)}`,
    provisionUrl: `${base}/provision/${input.shortCode}`,
  };
}

export async function provisionSignup(
  input: ProvisionSignupInput,
): Promise<ProvisionSignupResult> {
  const gmail = normalizeGmail(input.gmail);
  const phoneE164 = normalizePhoneE164(input.phoneE164);
  if (!phoneE164) throw new Error("invalid_phone");
  const preferredName = input.preferredName?.trim().slice(0, 80) || null;

  const { getNodePrisma } = await import("@/lib/db-node");
  const prisma = getNodePrisma();

  const existingIdentity = await prisma.callInIdentity.findFirst({
    where: {
      phoneE164: { in: phoneE164Candidates(phoneE164) },
      enabled: true,
    },
    orderBy: { updatedAt: "desc" },
  });
  if (existingIdentity) {
    const [user, request] = await Promise.all([
      prisma.user.findUnique({
        where: { id: existingIdentity.userId },
        select: { email: true },
      }),
      prisma.provisioningRequest.findUnique({
        where: { callInIdentityId: existingIdentity.id },
      }),
    ]);
    if (user?.email.toLowerCase() !== gmail) throw new Error("phone_in_use");
    if (request) {
      const links = await linksForRequest(request);
      return {
        requestId: request.id,
        userId: request.userId,
        phoneE164: request.phoneE164,
        gmail: request.gmail,
        shortCode: request.shortCode,
        ...links,
        status: provisioningStatus(request),
        created: false,
      };
    }

    const mailbox = existingIdentity.mailboxId
      ? await prisma.mailbox.findFirst({
          where: {
            id: existingIdentity.mailboxId,
            organizationId: existingIdentity.organizationId,
            workspaceId: existingIdentity.workspaceId,
            ownerId: existingIdentity.userId,
          },
          select: { id: true, connectionStatus: true },
        })
      : await prisma.mailbox.findFirst({
          where: {
            organizationId: existingIdentity.organizationId,
            workspaceId: existingIdentity.workspaceId,
            ownerId: existingIdentity.userId,
          },
          orderBy: { updatedAt: "desc" },
          select: { id: true, connectionStatus: true },
        });
    const connected =
      mailbox?.connectionStatus.toLowerCase() === "connected";
    const needsGoogleTestUser =
      !connected && process.env.GOOGLE_OAUTH_PUBLISHED !== "true";
    const restored = await prisma.provisioningRequest.upsert({
      where: { callInIdentityId: existingIdentity.id },
      update: {},
      create: {
        organizationId: existingIdentity.organizationId,
        workspaceId: existingIdentity.workspaceId,
        userId: existingIdentity.userId,
        callInIdentityId: existingIdentity.id,
        gmail,
        phoneE164,
        shortCode: createShortCode(),
        needsGoogleTestUser,
        googleTestUserEnabled: connected || !needsGoogleTestUser,
        provisionedReady: connected,
        connectedAt: connected ? new Date() : null,
      },
    });
    if (mailbox?.id && existingIdentity.mailboxId !== mailbox.id) {
      await prisma.callInIdentity.update({
        where: { id: existingIdentity.id },
        data: { mailboxId: mailbox.id },
      });
    }
    const links = await linksForRequest(restored);
    return {
      requestId: restored.id,
      userId: restored.userId,
      phoneE164: restored.phoneE164,
      gmail: restored.gmail,
      shortCode: restored.shortCode,
      ...links,
      status: provisioningStatus(restored),
      created: false,
    };
  }

  const existingUser = await prisma.user.findUnique({
    where: { email: gmail },
    select: { id: true },
  });
  if (existingUser) throw new Error("email_in_use");

  const ownerRole = await prisma.role.upsert({
    where: { key: "workspace_owner" },
    update: {},
    create: {
      key: "workspace_owner",
      name: "Workspace Owner",
      grantsMailboxAccessByDefault: true,
    },
  });
  const patronPlan = await prisma.subscriptionPlan.findUnique({
    where: { key: "patron" },
    select: { id: true },
  });
  const shortCode = createShortCode();
  const needsGoogleTestUser = process.env.GOOGLE_OAUTH_PUBLISHED !== "true";

  const created = await prisma.$transaction(async (tx) => {
    const organization = await tx.organization.create({
      data: {
        name: preferredName ? `${preferredName}'s workspace` : "Personal workspace",
        slug: `voice-${randomBytes(6).toString("hex")}`,
        accountType: "INDIVIDUAL",
        workspaces: { create: { name: "Primary" } },
        ...(patronPlan
          ? {
              subscriptions: {
                create: {
                  planId: patronPlan.id,
                  status: "TRIALING",
                  trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
                },
              },
            }
          : {}),
      },
      include: { workspaces: { take: 1 } },
    });
    const workspace = organization.workspaces[0];
    if (!workspace) throw new Error("workspace_create_failed");

    const user = await tx.user.create({
      data: {
        email: gmail,
        firstName: preferredName ?? "",
        preferredName,
        accessibilityPrefs: {
          create: {
            screenReaderOptimized: true,
            preferVoiceOnboarding: true,
          },
        },
        memberships: {
          create: {
            organizationId: organization.id,
            roleId: ownerRole.id,
          },
        },
      },
    });
    const identity = await tx.callInIdentity.create({
      data: {
        organizationId: organization.id,
        workspaceId: workspace.id,
        userId: user.id,
        phoneE164,
        label: "Primary phone",
        enabled: true,
        verifiedAt: new Date(),
      },
    });
    const request = await tx.provisioningRequest.create({
      data: {
        organizationId: organization.id,
        workspaceId: workspace.id,
        userId: user.id,
        callInIdentityId: identity.id,
        gmail,
        phoneE164,
        shortCode,
        needsGoogleTestUser,
        googleTestUserEnabled: !needsGoogleTestUser,
      },
    });
    return request;
  });

  const links = await linksForRequest(created);
  return {
    requestId: created.id,
    userId: created.userId,
    phoneE164: created.phoneE164,
    gmail: created.gmail,
    shortCode: created.shortCode,
    ...links,
    status: provisioningStatus(created),
    created: true,
  };
}

export async function getProvisioningStatusForPhone(
  rawPhone: string | null | undefined,
) {
  const phoneE164 = normalizePhoneE164(rawPhone);
  if (!phoneE164) return null;
  try {
    const { getNodePrisma } = await import("@/lib/db-node");
    const request = await getNodePrisma().provisioningRequest.findFirst({
      where: { phoneE164 },
      orderBy: { updatedAt: "desc" },
    });
    if (!request) return null;
    return {
      ...request,
      status: provisioningStatus(request),
      provisionUrl: `${appBaseUrl()}/provision/${request.shortCode}`,
    };
  } catch (error) {
    console.warn("[provisioning] status lookup failed", error);
    return null;
  }
}

export async function markProvisioningConnected(input: {
  organizationId: string;
  workspaceId: string;
  userId: string;
  mailboxId: string;
}) {
  const { getNodePrisma } = await import("@/lib/db-node");
  const prisma = getNodePrisma();
  await prisma.$transaction([
    prisma.provisioningRequest.updateMany({
      where: {
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        userId: input.userId,
      },
      data: {
        provisionedReady: true,
        connectedAt: new Date(),
      },
    }),
    prisma.callInIdentity.updateMany({
      where: {
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        userId: input.userId,
      },
      data: { mailboxId: input.mailboxId, enabled: true },
    }),
  ]);
}

export async function consumeConnectedTip(userId: string): Promise<boolean> {
  const { getNodePrisma } = await import("@/lib/db-node");
  const prisma = getNodePrisma();
  const request = await prisma.provisioningRequest.findFirst({
    where: { userId, provisionedReady: true, connectedTipSpoken: false },
    orderBy: { connectedAt: "desc" },
  });
  if (!request) return false;
  await prisma.provisioningRequest.updateMany({
    where: { id: request.id, connectedTipSpoken: false },
    data: { connectedTipSpoken: true },
  });
  return true;
}

export async function findProvisioningByCode(code: string) {
  const normalized = code.trim().toUpperCase();
  if (!/^[A-Z2-9]{8}$/.test(normalized)) return null;
  const { getNodePrisma } = await import("@/lib/db-node");
  return getNodePrisma().provisioningRequest.findUnique({
    where: { shortCode: normalized },
  });
}

export async function getMagicLinkForRequest(request: {
  id: string;
  userId: string;
  shortCode: string;
}) {
  return linksForRequest(request);
}

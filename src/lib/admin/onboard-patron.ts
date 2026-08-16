/**
 * Operator-only patron onboard: create/find user, upsert CallInIdentity,
 * return a plain-language checklist (Google test user / Published, etc.).
 */

import { randomBytes } from "node:crypto";
import { hashPassword } from "@/lib/auth";
import { normalizePhoneE164 } from "@/lib/call-in/identity";
import { isGoogleOauthPublished } from "@/lib/google-oauth-publication";
import { product } from "@/lib/product";

export type OnboardPatronInput = {
  patronName: string;
  gmail: string;
  phoneE164: string;
  /**
   * Required when GOOGLE_OAUTH_PUBLISHED is false:
   * operator confirms this Gmail was added as an OAuth test user.
   */
  gmailEnabledConfirmed?: boolean;
  /** When true and user exists, issue a fresh temporary password. */
  resetPassword?: boolean;
};

export type OnboardChecklistItem = {
  id: string;
  label: string;
  done: boolean;
  detail: string;
  /** Copy-paste helper for operators (e.g. test-user email). */
  copyValue?: string;
};

export type OnboardPatronResult = {
  ok: true;
  createdUser: boolean;
  userId: string;
  organizationId: string;
  workspaceId: string;
  phoneE164: string;
  gmail: string;
  preferredName: string;
  /** Temporary password when a new account was created or reset (operator shares once). */
  temporaryPassword: string | null;
  identityId: string;
  checklist: OnboardChecklistItem[];
  readyForInvite: boolean;
  inviteUrl: string;
  signInUrl: string;
  googlePublished: boolean;
  message: string;
};

const SIGN_IN_URL = "https://inbox-chief-kappa.vercel.app/signin";

function slugify(input: string) {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "workspace"
  );
}

export function googleAppPublished(): boolean {
  return isGoogleOauthPublished();
}

function makeTempPassword(): string {
  return `Ic-${randomBytes(6).toString("base64url")}`;
}

/**
 * Create or find patron, upsert CallInIdentity, build operator checklist.
 */
export async function onboardPatron(
  input: OnboardPatronInput,
): Promise<OnboardPatronResult> {
  const gmail = input.gmail.trim().toLowerCase();
  const patronName = input.patronName.trim();
  const phoneE164 = normalizePhoneE164(input.phoneE164);
  if (!phoneE164 || !/^\+[1-9]\d{7,14}$/.test(phoneE164)) {
    throw new Error("invalid_phone");
  }
  if (!patronName || patronName.length < 2) {
    throw new Error("invalid_name");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(gmail)) {
    throw new Error("invalid_gmail");
  }

  const published = googleAppPublished();
  if (!published && !input.gmailEnabledConfirmed) {
    throw new Error("gmail_not_confirmed");
  }

  const firstName = patronName.split(/\s+/)[0] ?? patronName;
  const lastName = patronName.split(/\s+/).slice(1).join(" ");

  const { getNodePrisma } = await import("@/lib/db-node");
  const prisma = getNodePrisma();

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
  });

  let createdUser = false;
  let temporaryPassword: string | null = null;
  let user = await prisma.user.findUnique({ where: { email: gmail } });

  if (!user) {
    temporaryPassword = makeTempPassword();
    const orgSlug = `${slugify(firstName)}-${Date.now().toString(36)}`;
    const organization = await prisma.organization.create({
      data: {
        name: `${firstName}'s workspace`,
        slug: orgSlug,
        accountType: "INDIVIDUAL",
        workspaces: { create: { name: "Primary" } },
        ...(patronPlan
          ? {
              subscriptions: {
                create: {
                  planId: patronPlan.id,
                  status: "TRIALING",
                  trialEndsAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14),
                },
              },
            }
          : {}),
      },
    });

    user = await prisma.user.create({
      data: {
        email: gmail,
        firstName,
        lastName,
        preferredName: firstName,
        passwordHash: hashPassword(temporaryPassword),
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
    createdUser = true;
  } else if (input.resetPassword) {
    temporaryPassword = makeTempPassword();
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: hashPassword(temporaryPassword) },
    });
  }

  const membership = await prisma.organizationMember.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    select: { organizationId: true },
  });
  if (!membership) {
    throw new Error("no_membership");
  }

  const workspace = await prisma.workspace.findFirst({
    where: { organizationId: membership.organizationId },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!workspace) {
    throw new Error("no_workspace");
  }

  const mailbox = await prisma.mailbox.findFirst({
    where: {
      organizationId: membership.organizationId,
      workspaceId: workspace.id,
      ownerId: user.id,
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true, emailAddress: true },
  });

  const identity = await prisma.callInIdentity.upsert({
    where: {
      organizationId_phoneE164: {
        organizationId: membership.organizationId,
        phoneE164,
      },
    },
    create: {
      organizationId: membership.organizationId,
      workspaceId: workspace.id,
      userId: user.id,
      mailboxId: mailbox?.id ?? null,
      phoneE164,
      label: "Primary phone",
      enabled: true,
      verifiedAt: new Date(),
    },
    update: {
      workspaceId: workspace.id,
      userId: user.id,
      mailboxId: mailbox?.id ?? null,
      label: "Primary phone",
      enabled: true,
      verifiedAt: new Date(),
    },
  });

  const gmailConfirmed = published || Boolean(input.gmailEnabledConfirmed);
  const checklist: OnboardChecklistItem[] = [
    {
      id: "account",
      label: "Patron account",
      done: true,
      detail: createdUser
        ? `Created ${gmail} with a temporary password (share once).`
        : input.resetPassword
          ? `Existing account ${gmail} — new temporary password issued.`
          : `Found existing account ${gmail}.`,
      copyValue: gmail,
    },
    {
      id: "call-in",
      label: "Call-in phone enabled",
      done: true,
      detail: `Calls from ${phoneE164} map to this patron. Dial +1 (405) 716-9240. Identity marked enabled.`,
      copyValue: phoneE164,
    },
  ];

  if (!published) {
    checklist.push({
      id: "google-test-user",
      label: "Gmail enabled for this patron (test user)",
      done: gmailConfirmed,
      detail: gmailConfirmed
        ? `Operator confirmed ${gmail} is an OAuth test user. Copy email below if you still need to paste into Google Cloud → Audience → Test users.`
        : `REQUIRED: add ${gmail} as a Google OAuth test user (Audience → Test users), then check “Gmail enabled for this patron” and submit again.`,
      copyValue: gmail,
    });
  } else {
    checklist.push({
      id: "google-published",
      label: "Google OAuth Published",
      done: true,
      detail:
        "GOOGLE_OAUTH_PUBLISHED=true — patrons can Connect Gmail without a test-user row.",
    });
  }

  const inviteReady = gmailConfirmed;
  checklist.push({
    id: "invite",
    label: "Invite ready",
    done: inviteReady,
    detail: inviteReady
      ? `Send ${SIGN_IN_URL} + temporary password. Patron: Connect Gmail → call from saved phone.`
      : "Confirm Gmail test-user step before marking invite ready.",
    copyValue: inviteReady ? SIGN_IN_URL : undefined,
  });

  const readyForInvite =
    checklist
      .filter((c) => c.id === "account" || c.id === "call-in")
      .every((c) => c.done) && inviteReady;

  return {
    ok: true,
    createdUser,
    userId: user.id,
    organizationId: membership.organizationId,
    workspaceId: workspace.id,
    phoneE164,
    gmail,
    preferredName: user.preferredName ?? firstName,
    temporaryPassword,
    identityId: identity.id,
    checklist,
    readyForInvite,
    inviteUrl: SIGN_IN_URL,
    signInUrl: SIGN_IN_URL,
    googlePublished: published,
    message: readyForInvite
      ? `${product.name}: ${firstName} is ready — share sign-in link and password.`
      : `${product.name}: onboard saved for ${firstName}. Finish Google test-user confirmation to invite.`,
  };
}

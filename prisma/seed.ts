/**
 * Inbox Chief database seed.
 *
 * Prerequisites:
 * 1. Set DATABASE_URL in `.env`
 * 2. `npx prisma generate` (works with a placeholder URL if needed)
 * 3. `npx prisma migrate dev` — migrations are required before seed can write rows
 * 4. `npm run db:seed` or `npx prisma db seed`
 *
 * Demo personas are OPTIONAL and off by default. Set SEED_DEMO_PERSONAS=true to create
 * isolated demo orgs (fake @example.com addresses only — not for production).
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { PERMISSIONS, ROLES, INDUSTRY_TEMPLATES, PROFESSIONAL_DISCLAIMER } from "../src/lib/rbac";
import { getSubscriptionPlanSeeds } from "../src/lib/billing/plans-sync";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "DATABASE_URL is required. Copy .env.example → .env, run migrations, then seed.",
  );
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function seedRolesAndPermissions() {
  for (const permission of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key: permission.key },
      create: {
        key: permission.key,
        name: permission.name,
        description: permission.mailbox
          ? "Mailbox-scoped permission"
          : "Organization-scoped permission",
      },
      update: {
        name: permission.name,
      },
    });
  }

  const permissionRows = await prisma.permission.findMany();
  const permissionByKey = new Map(permissionRows.map((p) => [p.key, p.id]));

  for (const role of ROLES) {
    const roleRow = await prisma.role.upsert({
      where: { key: role.key },
      create: {
        key: role.key,
        name: role.name,
        grantsMailboxAccessByDefault: role.grantsMailboxAccessByDefault,
      },
      update: {
        name: role.name,
        grantsMailboxAccessByDefault: role.grantsMailboxAccessByDefault,
      },
    });

    for (const permissionKey of role.permissions) {
      const permissionId = permissionByKey.get(permissionKey);
      if (!permissionId) continue;

      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: roleRow.id,
            permissionId,
          },
        },
        create: {
          roleId: roleRow.id,
          permissionId,
        },
        update: {},
      });
    }
  }
}

async function seedSubscriptionPlans() {
  for (const plan of getSubscriptionPlanSeeds()) {
    await prisma.subscriptionPlan.upsert({
      where: { key: plan.key },
      create: {
        key: plan.key,
        name: plan.name,
        monthlyPriceUsd: plan.monthlyPriceUsd,
        customPricing: plan.customPricing,
        maxUsers: plan.maxUsers,
        maxMailboxes: plan.maxMailboxes,
        maxAssistants: plan.maxAssistants,
        aiUsageMonthly: plan.aiUsageMonthly,
        features: plan.features,
        stripePriceId: plan.stripePriceId,
        active: plan.active,
      },
      update: {
        name: plan.name,
        monthlyPriceUsd: plan.monthlyPriceUsd,
        customPricing: plan.customPricing,
        maxUsers: plan.maxUsers,
        maxMailboxes: plan.maxMailboxes,
        maxAssistants: plan.maxAssistants,
        aiUsageMonthly: plan.aiUsageMonthly,
        features: plan.features,
        stripePriceId: plan.stripePriceId,
        active: plan.active,
      },
    });
  }
}

async function seedIndustryTemplates() {
  for (const template of INDUSTRY_TEMPLATES) {
    await prisma.industryTemplate.upsert({
      where: { key: template.key },
      create: {
        key: template.key,
        name: template.name,
        description: template.description,
        suggestedCategories: [...template.suggestedCategories],
        suggestedRules: [],
        disclaimer: PROFESSIONAL_DISCLAIMER,
      },
      update: {
        name: template.name,
        description: template.description,
        suggestedCategories: [...template.suggestedCategories],
        disclaimer: PROFESSIONAL_DISCLAIMER,
      },
    });
  }
}

/** Demo-only personas — never production defaults. Fake example.com emails only. */
const DEMO_PERSONAS = [
  {
    slug: "demo-small-business",
    orgName: "[DEMO] Small Business Owner",
    accountType: "SMALL_BUSINESS" as const,
    templateKey: "small_business",
    email: "alex.owner@example.com",
    firstName: "Alex",
    lastName: "Owner",
    occupation: "Small business owner",
    workspaceName: "Main office",
  },
  {
    slug: "demo-physician",
    orgName: "[DEMO] Physician Practice",
    accountType: "PROFESSIONAL_PRACTICE" as const,
    templateKey: "medical_healthcare",
    email: "jordan.physician@example.com",
    firstName: "Jordan",
    lastName: "Physician",
    occupation: "Physician",
    workspaceName: "Practice inbox",
  },
  {
    slug: "demo-professor",
    orgName: "[DEMO] University Professor",
    accountType: "INDIVIDUAL" as const,
    templateKey: "scientific_academic",
    email: "sam.professor@example.com",
    firstName: "Sam",
    lastName: "Professor",
    occupation: "University professor",
    workspaceName: "Faculty correspondence",
  },
  {
    slug: "demo-real-estate",
    orgName: "[DEMO] Real Estate Manager",
    accountType: "SMALL_BUSINESS" as const,
    templateKey: "real_estate",
    email: "taylor.realtor@example.com",
    firstName: "Taylor",
    lastName: "Realtor",
    occupation: "Real estate manager",
    workspaceName: "Listings & clients",
  },
  {
    slug: "demo-consultant",
    orgName: "[DEMO] Independent Consultant",
    accountType: "INDIVIDUAL" as const,
    templateKey: "consulting",
    email: "morgan.consultant@example.com",
    firstName: "Morgan",
    lastName: "Consultant",
    occupation: "Consultant",
    workspaceName: "Client delivery",
  },
] as const;

async function seedDemoPersonas() {
  const ownerRole = await prisma.role.findUniqueOrThrow({
    where: { key: "workspace_owner" },
  });
  const templates = await prisma.industryTemplate.findMany();
  const templateByKey = new Map(templates.map((t) => [t.key, t.id]));
  const patronPlan = await prisma.subscriptionPlan.findUnique({
    where: { key: "patron" },
  });

  for (const persona of DEMO_PERSONAS) {
    const user = await prisma.user.upsert({
      where: { email: persona.email },
      create: {
        email: persona.email,
        firstName: persona.firstName,
        lastName: persona.lastName,
        occupation: persona.occupation,
        preferredName: persona.firstName,
      },
      update: {
        firstName: persona.firstName,
        lastName: persona.lastName,
        occupation: persona.occupation,
      },
    });

    await prisma.accessibilityPreference.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        screenReaderOptimized: true,
        preferVoiceOnboarding: true,
      },
      update: {},
    });

    const organization = await prisma.organization.upsert({
      where: { slug: persona.slug },
      create: {
        name: persona.orgName,
        slug: persona.slug,
        accountType: persona.accountType,
      },
      update: {
        name: persona.orgName,
        accountType: persona.accountType,
      },
    });

    await prisma.organizationMember.upsert({
      where: {
        organizationId_userId: {
          organizationId: organization.id,
          userId: user.id,
        },
      },
      create: {
        organizationId: organization.id,
        userId: user.id,
        roleId: ownerRole.id,
      },
      update: {
        roleId: ownerRole.id,
      },
    });

    const existingWorkspace = await prisma.workspace.findFirst({
      where: {
        organizationId: organization.id,
        name: persona.workspaceName,
      },
    });

    const workspace =
      existingWorkspace ??
      (await prisma.workspace.create({
        data: {
          organizationId: organization.id,
          name: persona.workspaceName,
          industryTemplateId: templateByKey.get(persona.templateKey) ?? null,
        },
      }));

    if (patronPlan) {
      const existingSub = await prisma.subscription.findFirst({
        where: { organizationId: organization.id },
      });
      if (!existingSub) {
        await prisma.subscription.create({
          data: {
            organizationId: organization.id,
            planId: patronPlan.id,
            status: "TRIALING",
          },
        });
      }
    }

    console.log(
      `  demo persona: ${persona.email} → org ${organization.slug} / workspace ${workspace.name}`,
    );
  }
}

async function main() {
  console.log("Seeding roles & permissions…");
  await seedRolesAndPermissions();

  console.log("Seeding subscription plans…");
  await seedSubscriptionPlans();

  console.log("Seeding industry templates…");
  await seedIndustryTemplates();

  if (process.env.SEED_DEMO_PERSONAS === "true") {
    console.log("Seeding OPTIONAL demo personas (not production defaults)…");
    await seedDemoPersonas();
  } else {
    console.log(
      "Skipping demo personas (set SEED_DEMO_PERSONAS=true to include).",
    );
  }

  console.log("Seed complete.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

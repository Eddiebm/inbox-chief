/**
 * Operator CLI: set a temporary password for a patron (or operator) account.
 *
 * Usage:
 *   npx tsx scripts/reset-password.ts --email eddie@coareholdings.com
 *   npx tsx scripts/reset-password.ts --email patron@example.com --password 'Custom-Pass-123'
 *   npx tsx scripts/reset-password.ts --email patron@example.com --reset-link
 *
 * Requires DATABASE_URL and AUTH_SECRET (loads from .env via dotenv).
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { hashPassword } from "../src/lib/auth";
import { createPasswordResetToken } from "../src/lib/auth/password-reset";
import { product } from "../src/lib/product";

type Args = {
  email?: string;
  password?: string;
  resetLink: boolean;
  dryRun: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { resetLink: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const next = argv[i + 1];
    switch (flag) {
      case "--email":
        args.email = next;
        i++;
        break;
      case "--password":
        args.password = next;
        i++;
        break;
      case "--reset-link":
        args.resetLink = true;
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      default:
        break;
    }
  }
  return args;
}

function usage(): never {
  console.error(`Usage:
  npx tsx scripts/reset-password.ts --email ADDR [options]

Options:
  --password TEXT   Set this password (min 10 chars). Default: generated Ic-* temp password.
  --reset-link      Also print a 1-hour reset URL (uses AUTH_SECRET + NEXT_PUBLIC_APP_URL).
  --dry-run         Look up user only; do not write.
`);
  process.exit(1);
}

function makeTempPassword(): string {
  return `Ic-${randomBytes(6).toString("base64url")}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.email?.trim()) {
    usage();
  }

  const email = args.email.trim().toLowerCase();
  const temporaryPassword = args.password?.trim() || makeTempPassword();

  if (temporaryPassword.length < 10) {
    console.error("Error: password must be at least 10 characters");
    process.exit(1);
  }

  if (!process.env.DATABASE_URL?.trim()) {
    console.error("Error: DATABASE_URL is required");
    process.exit(1);
  }

  const { getNodePrisma } = await import("../src/lib/db-node");
  const prisma = getNodePrisma();

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, firstName: true, lastName: true, passwordHash: true },
  });

  if (!user) {
    console.error(`Error: no user found for ${email}`);
    process.exit(1);
  }

  const preview = {
    userId: user.id,
    email: user.email,
    name: [user.firstName, user.lastName].filter(Boolean).join(" ") || null,
    hadPassword: Boolean(user.passwordHash),
    dryRun: args.dryRun,
  };

  if (args.dryRun) {
    console.log(JSON.stringify(preview, null, 2));
    return;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: hashPassword(temporaryPassword) },
  });

  const base =
    process.env.NEXT_PUBLIC_APP_URL?.trim() || product.url.replace(/\/$/, "");
  const signInUrl = `${base}/login`;
  const resetUrl = args.resetLink
    ? `${base}/reset-password?token=${encodeURIComponent(createPasswordResetToken(user.id, user.email))}`
    : null;

  console.log(
    JSON.stringify(
      {
        ...preview,
        updated: true,
        temporaryPassword,
        signInUrl,
        resetUrl,
        note: "Share temporaryPassword once, then ask patron to change it in Settings when available.",
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

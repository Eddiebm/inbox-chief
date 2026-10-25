/**
 * Operator CLI: grant prepaid call minutes without Stripe.
 *
 * Usage:
 *   npx tsx scripts/grant-minutes.ts --email courtneycdx@gmail.com --minutes 120
 *   npx tsx scripts/grant-minutes.ts --phone +14055106989 --minutes 120 --reason "Founder comp"
 *   npx tsx scripts/grant-minutes.ts --org-id clxyz... --minutes 60 --dry-run
 *
 * Requires DATABASE_URL (loads from .env via dotenv).
 */
import "dotenv/config";
import {
  grantOperatorMinutes,
  resolveOrgForGrant,
} from "../src/lib/billing/grant-minutes";
import { loadCallMinuteUsageForOrg } from "../src/lib/billing/call-usage-server";

type Args = {
  email?: string;
  phone?: string;
  mailbox?: string;
  orgId?: string;
  minutes: number;
  grantedBy?: string;
  reason?: string;
  idempotencyKey?: string;
  dryRun: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { minutes: 0, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const next = argv[i + 1];
    switch (flag) {
      case "--email":
        args.email = next;
        i++;
        break;
      case "--phone":
        args.phone = next;
        i++;
        break;
      case "--mailbox":
        args.mailbox = next;
        i++;
        break;
      case "--org-id":
        args.orgId = next;
        i++;
        break;
      case "--minutes":
        args.minutes = Number(next);
        i++;
        break;
      case "--granted-by":
        args.grantedBy = next;
        i++;
        break;
      case "--reason":
        args.reason = next;
        i++;
        break;
      case "--idempotency-key":
        args.idempotencyKey = next;
        i++;
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
  npx tsx scripts/grant-minutes.ts (--email ADDR | --phone E164 | --mailbox ADDR | --org-id ID) --minutes N [options]

Options:
  --granted-by EMAIL     Operator identity for audit log
  --reason TEXT          Free-text note (audit log)
  --idempotency-key KEY  Prevent double-grant on re-run
  --dry-run              Resolve patron and show before/after without writing
`);
  process.exit(1);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (
    !args.email &&
    !args.phone &&
    !args.mailbox &&
    !args.orgId
  ) {
    usage();
  }
  if (!Number.isFinite(args.minutes) || args.minutes <= 0) {
    console.error("Error: --minutes must be a positive number");
    process.exit(1);
  }

  const resolved = await resolveOrgForGrant({
    email: args.email,
    phone: args.phone,
    mailbox: args.mailbox,
    organizationId: args.orgId,
  });

  if (!resolved.found) {
    console.error(`Error: could not resolve organization (${resolved.reason})`);
    process.exit(1);
  }

  const usageBefore = await loadCallMinuteUsageForOrg(resolved.organizationId);

  const preview = {
    patron: resolved.label,
    organizationId: resolved.organizationId,
    organizationName: resolved.organizationName,
    minutesToGrant: args.minutes,
    before: {
      purchasedMinutesRemaining: usageBefore.purchasedMinutesRemaining,
      includedMinutesRemaining: usageBefore.minutesRemaining,
      totalMinutesRemaining: usageBefore.totalMinutesRemaining,
    },
    after: {
      purchasedMinutesRemaining:
        usageBefore.purchasedMinutesRemaining + args.minutes,
      includedMinutesRemaining: usageBefore.minutesRemaining,
      totalMinutesRemaining:
        usageBefore.totalMinutesRemaining + args.minutes,
    },
    dryRun: args.dryRun,
  };

  if (args.dryRun) {
    console.log(JSON.stringify(preview, null, 2));
    return;
  }

  const result = await grantOperatorMinutes({
    organizationId: resolved.organizationId,
    workspaceId: resolved.workspaceId,
    minutes: args.minutes,
    grantedBy: args.grantedBy ?? process.env.OPERATOR_GRANT_BY ?? null,
    reason: args.reason ?? null,
    idempotencyKey: args.idempotencyKey ?? null,
  });

  if (!result.granted) {
    console.error(`Error: grant failed (${result.reason})`);
    process.exit(1);
  }

  const usageAfter = await loadCallMinuteUsageForOrg(resolved.organizationId);

  console.log(
    JSON.stringify(
      {
        ...preview,
        granted: true,
        idempotent: result.idempotent,
        purchaseId: result.purchaseId,
        purchasedMinutesBefore: result.purchasedMinutesBefore,
        purchasedMinutesAfter: result.purchasedMinutesRemaining,
        after: {
          purchasedMinutesRemaining: usageAfter.purchasedMinutesRemaining,
          includedMinutesRemaining: usageAfter.minutesRemaining,
          totalMinutesRemaining: usageAfter.totalMinutesRemaining,
        },
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

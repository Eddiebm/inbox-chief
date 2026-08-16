import { filterMessagesByInboxScope } from "@/lib/call-in/primary-inbox";

export type MessageForNewPrimaryCount = {
  fromAddress: string;
  metadata?: unknown;
  categoryName?: string | null;
  receivedAt: Date;
};

type PrismaLikeForNewPrimaryCount = {
  message: {
    findMany(args: {
      where: Record<string, unknown>;
      select: {
        fromAddress: true;
        metadata: true;
        categoryName: true;
        receivedAt: true;
      };
    }): Promise<MessageForNewPrimaryCount[]>;
  };
};

/** Count real Primary-classified messages received after the last completed call. */
export async function loadNewPrimaryCount(input: {
  prisma: PrismaLikeForNewPrimaryCount;
  tenantFilter: Record<string, string>;
  since: Date | null;
}): Promise<number> {
  const messages = await input.prisma.message.findMany({
    where: {
      ...input.tenantFilter,
      ...(input.since ? { receivedAt: { gt: input.since } } : {}),
    },
    select: {
      fromAddress: true,
      metadata: true,
      categoryName: true,
      receivedAt: true,
    },
  });

  return filterMessagesByInboxScope(messages, "primary").kept.length;
}

/** Exact accessibility-first line used in the opening and briefing tools. */
export function speakNewPrimaryCount(input: {
  count: number;
  isFirstCall: boolean;
}): string {
  const count = Math.max(0, Math.floor(input.count));
  if (input.isFirstCall) {
    return `Welcome. You have ${count} message${count === 1 ? "" : "s"} in Primary.`;
  }
  if (count === 0) {
    return "No new emails since your last call.";
  }
  return `You have ${count} new email${count === 1 ? "" : "s"} in Primary since your last call.`;
}

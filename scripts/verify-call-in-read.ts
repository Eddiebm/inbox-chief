/**
 * End-to-end check of the call-in read path against the real mailbox.
 * Reads only — never sends mail.
 *
 * Usage: npx tsx scripts/verify-call-in-read.ts +14055106989
 */
import "dotenv/config";
import { resolveSnapshotForCaller } from "../src/lib/call-in/identity";
import { handleCallInTool } from "../src/lib/call-in/vapi-tools";

async function main() {
  const phone = process.argv[2] ?? "+14055106989";
  const callId = `verify_${Date.now()}`;

  const resolved = await resolveSnapshotForCaller(phone);
  const snap = resolved.snapshot;
  console.log("matched:", resolved.matched, "source:", resolved.source);
  console.log("mailbox:", snap.mailboxEmail, "status:", snap.connectionStatus);
  console.log("identityStatus:", snap.identityStatus);
  console.log("readable Primary emails:", snap.readableEmails.length);
  console.log("non-primary available:", snap.readableEmailsNonPrimary.length);
  console.log("skipped non-primary:", snap.skippedNonPrimaryCount);
  console.log("briefing:", snap.briefing.slice(0, 200));
  console.log("\nPrimary list:");
  snap.readableEmails.forEach((e, i) => {
    console.log(
      `  ${i + 1}. ${e.fromAddress.slice(0, 40)} | ${e.subject.slice(0, 52)} | ${e.contentSource}`,
    );
  });

  const first = await handleCallInTool({
    name: "read_emails",
    args: { position: "first" },
    snapshot: snap,
    requestedById: resolved.userId,
    callInIdentityId: resolved.callInIdentityId,
    callId,
  });
  console.log("\n[read 1]", first.spoken);

  for (let turn = 2; turn <= 4; turn++) {
    const next = await handleCallInTool({
      name: "read_emails",
      args: { position: "next" },
      snapshot: snap,
      requestedById: resolved.userId,
      callInIdentityId: resolved.callInIdentityId,
      callId,
    });
    console.log(`\n[next → ${turn}]`, next.spoken.slice(0, 320));
  }

  // Attachment bytes should only be downloaded for the email being read.
  const withAttachment = snap.readableEmails.findIndex(
    (e) => (e.attachments ?? []).length > 0,
  );
  if (withAttachment >= 0) {
    console.log(
      `\nattachments on email ${withAttachment + 1} before reading:`,
      JSON.stringify(
        snap.readableEmails[withAttachment]?.attachments?.map((a) => ({
          filename: a.filename,
          status: a.status,
        })),
      ),
    );
    const read = await handleCallInTool({
      name: "read_emails",
      args: { startIndex: withAttachment },
      snapshot: snap,
      requestedById: resolved.userId,
      callInIdentityId: resolved.callInIdentityId,
      callId,
    });
    console.log(`\n[read ${withAttachment + 1} with attachment]`, read.spoken);
  } else {
    console.log("\nNo attachments in the current Primary window.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

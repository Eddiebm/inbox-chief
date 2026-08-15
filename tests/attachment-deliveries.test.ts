import { describe, expect, it } from "vitest";
import {
  attachmentTargetFromSnapshot,
  safeDownloadFilename,
} from "@/lib/attachment-deliveries";
import { demoMailboxSnapshot } from "@/lib/call-in/assistant";
import {
  buildCallInSystemPrompt,
  buildCallInVapiTools,
} from "@/lib/call-in/vapi-tools";
import { attachmentRouteNumbers } from "@/app/api/call-in/ask/route";

describe("attachment computer downloads", () => {
  it("selects only the numbered attachment from the current Primary email", () => {
    const snapshot = demoMailboxSnapshot("Patron");
    snapshot.identityStatus = "matched";
    snapshot.organizationId = "org_1";
    snapshot.workspaceId = "ws_1";
    snapshot.mailboxId = "mb_1";
    snapshot.readableEmails[0] = {
      ...snapshot.readableEmails[0]!,
      messageId: "message_1",
      gmailMessageId: "gmail_1",
      attachments: [
        {
          attachmentId: "attachment_1",
          filename: "agenda.pdf",
          mimeType: "application/pdf",
          size: 2048,
          speakableType: "PDF",
          status: "ok",
          readableText: "Agenda",
          remainingText: "",
        },
      ],
    };

    const target = attachmentTargetFromSnapshot(snapshot, 1, 1);
    expect(target).toMatchObject({
      ok: true,
      emailIndex: 0,
      attachmentIndex: 0,
      attachment: { filename: "agenda.pdf", attachmentId: "attachment_1" },
    });
    expect(attachmentTargetFromSnapshot(snapshot, 2, 1)).toMatchObject({
      ok: false,
      reason: "attachment_not_found",
    });
  });

  it("sanitizes filenames used in Content-Disposition", () => {
    expect(safeDownloadFilename('report"\r\n.pdf')).toBe("report___.pdf");
    expect(safeDownloadFilename("../../agenda.pdf")).toBe(".._.._agenda.pdf");
  });

  it("registers the VAPI routing tool and forbids emailing files", () => {
    const tools = buildCallInVapiTools("https://example.test");
    expect(tools.some((tool) => tool.function.name === "route_attachment")).toBe(
      true,
    );
    const prompt = buildCallInSystemPrompt();
    expect(prompt).toMatch(/secure signed-in Downloads page/i);
    expect(prompt).toMatch(/Never ask for or email the file/i);
  });

  it("recognizes the requested web Ask phrases", () => {
    expect(attachmentRouteNumbers("send this attachment to my computer")).toEqual({
      emailNumber: 1,
      attachmentNumber: 1,
    });
    expect(attachmentRouteNumbers("download on my laptop")).toEqual({
      emailNumber: 1,
      attachmentNumber: 1,
    });
    expect(attachmentRouteNumbers("route attachment 2 from email 3")).toEqual({
      emailNumber: 3,
      attachmentNumber: 2,
    });
    expect(attachmentRouteNumbers("read attachment 1")).toBeNull();
  });
});

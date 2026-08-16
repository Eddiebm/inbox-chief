import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatAttachmentChoicesForSpeech,
  speakSelectedAttachment,
  summarizeAttachmentForSpeech,
  type CallInMailboxSnapshot,
  type CallInReadableEmail,
} from "@/lib/call-in/assistant";
import type { CallInAttachmentSpeech } from "@/lib/gmail/attachments";
import type { StoredReadCursor } from "@/lib/call-in/read-cursor";

const mocks = vi.hoisted(() => ({
  cursor: null as StoredReadCursor | null,
  enrich: vi.fn(),
}));

vi.mock("@/lib/call-in/read-cursor", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/call-in/read-cursor")>();
  return {
    ...actual,
    loadReadCursor: async () => mocks.cursor,
    saveReadCursor: async (input: {
      index: number;
      callId?: string | null;
      scope?: string;
      bodyOffset?: number;
      bodyKey?: string | null;
      attachmentOffset?: number;
      attachmentKey?: string | null;
    }) => {
      mocks.cursor = {
        index: input.index,
        callId: input.callId ?? null,
        scope: input.scope ?? null,
        at: new Date(),
        bodyOffset: input.bodyOffset ?? 0,
        bodyKey: input.bodyKey ?? null,
        attachmentOffset: input.attachmentOffset ?? 0,
        attachmentKey: input.attachmentKey ?? null,
      };
    },
  };
});

vi.mock("@/lib/call-in/full-body", () => ({
  ensureFullBodyForSpeech: async ({ email }: { email: CallInReadableEmail }) =>
    email,
}));

vi.mock("@/lib/call-in/attachment-enrichment", () => ({
  enrichReadableEmailOnDemand: (...args: unknown[]) =>
    mocks.enrich(...(args as [])),
}));

import {
  buildCallInVapiTools,
  handleCallInTool,
  parseAttachmentRequest,
  readIntentFromQuestion,
} from "@/lib/call-in/vapi-tools";

const extractedText = Array.from(
  { length: 50 },
  (_, index) => `FILE${index + 1}: exact attachment sentence ${index + 1}.`,
).join(" ");

function pendingAttachment(
  filename: string,
  type = "PDF",
): CallInAttachmentSpeech {
  return {
    attachmentId: `att_${filename}`,
    filename,
    mimeType: type === "PDF" ? "application/pdf" : "text/plain",
    size: 20_000,
    speakableType: type,
    status: "unsupported",
    readableText: "",
    remainingText: "",
    reason: `I can note the filename: ${filename}. Full attachment text was not loaded yet.`,
  };
}

function message(attachments: CallInAttachmentSpeech[]): CallInReadableEmail {
  return {
    messageId: "m1",
    gmailMessageId: "g1",
    fromAddress: "Jordan <jordan@example.com>",
    subject: "Documents",
    readableText: "Please review the attached documents.",
    contentSource: "body",
    inboxTab: "primary",
    attachments,
  };
}

function snapshot(email: CallInReadableEmail): CallInMailboxSnapshot {
  return {
    organizationId: "org",
    workspaceId: "ws",
    mailboxId: "mb",
    ownerFirstName: "Eddie",
    mailboxEmail: "eddie@example.com",
    connectionStatus: "connected",
    identityStatus: "matched",
    needingAttention: 1,
    draftsAwaitingReview: 0,
    approvalsPending: 0,
    followUpsDue: 0,
    upcomingDeadlines: [],
    briefing: "ready",
    recentSubjects: [email.subject],
    readableEmails: [email],
    readableEmailsNonPrimary: [],
    skippedNonPrimaryCount: 0,
    securityNote: "linked",
    voiceTier: "standard",
  };
}

function call(
  args: Record<string, unknown>,
  current: CallInMailboxSnapshot,
) {
  return handleCallInTool({
    name: "read_emails",
    args,
    snapshot: current,
    callInIdentityId: "identity",
    callId: "call",
  });
}

beforeEach(() => {
  mocks.cursor = null;
  mocks.enrich.mockReset();
  mocks.enrich.mockImplementation(
    async ({ email }: { email: CallInReadableEmail }) => {
      email.attachments = (email.attachments ?? []).map((attachment) => {
        if (attachment.filename === "locked.pdf") {
          return {
            ...attachment,
            status: "encrypted_or_unreadable" as const,
            reason:
              "I couldn't extract text from this PDF — it may be encrypted or image-only.",
          };
        }
        return {
          ...attachment,
          status: "ok" as const,
          readableText: extractedText.slice(0, 480),
          remainingText: extractedText.slice(480),
          fullText: extractedText,
          reason: undefined,
        };
      });
      return email;
    },
  );
});

describe("attachment choice announcements", () => {
  it("announces a single attachment without exposing its contents", () => {
    const spoken = formatAttachmentChoicesForSpeech([
      pendingAttachment("invoice.pdf"),
    ]);
    expect(spoken).toMatch(/1 attachment: invoice\.pdf, PDF/i);
    expect(spoken).toMatch(/read it in full/i);
    expect(spoken).toMatch(/extractive summary/i);
    expect(spoken).toMatch(/skip it/i);
    expect(spoken).not.toContain("FILE1:");
  });

  it("announces multiple filenames and offers a specific file or all", () => {
    const spoken = formatAttachmentChoicesForSpeech([
      pendingAttachment("invoice.pdf"),
      pendingAttachment("notes.docx", "Word document"),
    ]);
    expect(spoken).toMatch(/2 attachments/i);
    expect(spoken).toContain("invoice.pdf, PDF");
    expect(spoken).toContain("notes.docx, Word document");
    expect(spoken).toMatch(/specific attachment/i);
    expect(spoken).toMatch(/all of them one at a time/i);
  });

  it("does not prefetch before the patron chooses", async () => {
    const current = snapshot(message([pendingAttachment("invoice.pdf")]));
    const result = await call({ position: "first" }, current);
    expect(result.spoken).toContain("invoice.pdf");
    expect(result.spoken).not.toContain("FILE1:");
    expect(mocks.enrich).not.toHaveBeenCalled();
  });
});

describe("attachment choice routing", () => {
  it("recognizes read, summary, skip, filename, ordinal, and all variants", () => {
    expect(parseAttachmentRequest({ question: "read it" })).toMatchObject({
      action: "read",
    });
    expect(parseAttachmentRequest({ question: "read in full" })).toMatchObject({
      action: "read",
    });
    expect(
      parseAttachmentRequest({ question: "give me a summary" }),
    ).toMatchObject({ action: "summary" });
    expect(
      parseAttachmentRequest({ question: "skip attachments" }),
    ).toMatchObject({ action: "skip" });
    expect(
      parseAttachmentRequest({ question: "read the second attachment" }),
    ).toMatchObject({ action: "read", index: 1 });
    expect(
      parseAttachmentRequest({
        attachmentAction: "read",
        attachmentName: "invoice.pdf",
      }),
    ).toMatchObject({ action: "read", filename: "invoice.pdf" });
    expect(
      parseAttachmentRequest({ question: "read all attachments" }),
    ).toMatchObject({ action: "read", all: true });
    expect(readIntentFromQuestion("summarize it")).toMatchObject({
      attachmentAction: "summary",
    });
  });

  it("exposes attachment choices in the VAPI tool schema", () => {
    const read = buildCallInVapiTools("https://example.com").find(
      (tool) => tool.function.name === "read_emails",
    );
    const parameters = read?.function.parameters as {
      properties?: Record<string, unknown>;
    };
    expect(parameters.properties).toHaveProperty("attachmentAction");
    expect(parameters.properties).toHaveProperty("attachmentIndex");
    expect(parameters.properties).toHaveProperty("attachmentName");
    expect(parameters.properties).toHaveProperty("allAttachments");
  });

  it("requires a choice when multiple attachments are ambiguous", async () => {
    const current = snapshot(
      message([
        pendingAttachment("invoice.pdf"),
        pendingAttachment("notes.docx", "Word document"),
      ]),
    );
    await call({ position: "first" }, current);
    const result = await call({ attachmentAction: "read" }, current);
    expect(result.spoken).toMatch(/choose an attachment by filename or number/i);
    expect(result.spoken).toContain("invoice.pdf");
    expect(result.spoken).toContain("notes.docx");
    expect(mocks.enrich).toHaveBeenCalledTimes(1);
  });
});

describe("attachment reading after consent", () => {
  it("fetches only after consent and continues a full read", async () => {
    const current = snapshot(message([pendingAttachment("invoice.pdf")]));
    await call({ position: "first" }, current);
    const first = await call({ attachmentAction: "read" }, current);
    expect(mocks.enrich).toHaveBeenCalledTimes(1);
    expect(first.spoken).toMatch(/Reading invoice\.pdf, PDF, in full/i);
    expect(first.spoken).toContain("FILE1:");
    expect(first.spoken).toMatch(/say continue to hear the rest/i);
    expect(mocks.cursor?.attachmentOffset).toBeGreaterThan(0);

    const second = await call({ position: "continue" }, current);
    expect(second.spoken).toMatch(/Continuing invoice\.pdf/i);
    expect(second.spoken).not.toContain("FILE1:");
  });

  it("labels summaries and never presents them as full content", async () => {
    const current = snapshot(message([pendingAttachment("invoice.pdf")]));
    await call({ position: "first" }, current);
    const summary = await call({ attachmentAction: "summary" }, current);
    expect(summary.spoken).toMatch(/^Summary of invoice\.pdf:/i);
    expect(summary.spoken).toMatch(/extractive summary/i);
    expect(summary.spoken).toMatch(/not the full content/i);
    expect(summary.spoken).not.toMatch(/Reading .* in full/i);
    expect(mocks.cursor?.attachmentKey).toBeNull();
  });

  it("summarize instead clears an interrupted full-read cursor", async () => {
    const current = snapshot(message([pendingAttachment("invoice.pdf")]));
    await call({ position: "first" }, current);
    await call({ attachmentAction: "read" }, current);
    expect(mocks.cursor?.attachmentKey).not.toBeNull();
    const summary = await call(
      { attachmentAction: "summary", attachmentIndex: 1 },
      current,
    );
    expect(summary.spoken).toMatch(/^Summary/i);
    expect(mocks.cursor?.attachmentKey).toBeNull();
    expect(mocks.cursor?.attachmentOffset).toBe(0);
  });

  it("reads all attachments one at a time", async () => {
    const current = snapshot(
      message([
        pendingAttachment("invoice.pdf"),
        pendingAttachment("notes.docx", "Word document"),
      ]),
    );
    await call({ position: "first" }, current);
    const first = await call(
      { attachmentAction: "read", allAttachments: true },
      current,
    );
    expect(first.spoken).toMatch(/Reading invoice\.pdf/i);

    let heardSecond = false;
    for (let turn = 0; turn < 10; turn++) {
      const more = await call({ position: "continue" }, current);
      if (/Reading notes\.docx/i.test(more.spoken)) {
        heardSecond = true;
        break;
      }
    }
    expect(heardSecond).toBe(true);
  });

  it("explains unsupported extraction and never invents contents", async () => {
    const current = snapshot(message([pendingAttachment("locked.pdf")]));
    await call({ position: "first" }, current);
    const result = await call({ attachmentAction: "read" }, current);
    expect(result.spoken).toMatch(/couldn't extract text/i);
    expect(result.spoken).toMatch(/encrypted or image-only/i);
    expect(result.spoken).not.toContain("FILE1:");
  });

  it("skip attachments does not fetch, while next email abandons full reading", async () => {
    const current = snapshot(message([pendingAttachment("invoice.pdf")]));
    await call({ position: "first" }, current);
    const skipped = await call({ attachmentAction: "skip" }, current);
    expect(skipped.spoken).toMatch(/Skipping the attachments/i);
    expect(mocks.enrich).not.toHaveBeenCalled();

    await call({ attachmentAction: "read" }, current);
    expect(mocks.cursor?.attachmentKey).not.toBeNull();
    const next = await call({ position: "skip" }, current);
    expect(next.spoken).toMatch(/end of the list/i);
    expect(mocks.cursor?.attachmentKey).toBeNull();
  });
});

describe("pure attachment speech safety", () => {
  it("a full reader reports unsupported content plainly", () => {
    const spoken = speakSelectedAttachment(
      pendingAttachment("photo.jpg", "image"),
    );
    expect(spoken.spoken).toMatch(/not loaded yet/i);
    expect(spoken.nextOffset).toBe(0);
  });

  it("a deterministic summary is explicitly limited", () => {
    const attachment: CallInAttachmentSpeech = {
      ...pendingAttachment("notes.txt", "text file"),
      status: "ok",
      readableText: "First fact. Second fact.",
      remainingText: "",
      fullText: "First fact. Second fact.",
    };
    const spoken = summarizeAttachmentForSpeech(attachment);
    expect(spoken).toMatch(/^Summary of notes\.txt:/);
    expect(spoken).toMatch(/not a verbatim full reading/i);
  });
});

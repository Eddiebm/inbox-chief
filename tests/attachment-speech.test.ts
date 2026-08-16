import { describe, expect, it } from "vitest";
import { extractGmailAttachmentMeta } from "@/lib/gmail/attachments";
import {
  extractAttachmentText,
  extractPdfPlainText,
  MAX_ATTACHMENT_BYTES,
  sliceAttachmentTextForSpeech,
  speakableAttachmentType,
} from "@/lib/mail/attachment-text";
import {
  formatAttachmentsForSpeech,
  formatReadableEmailForSpeech,
  speakMoreAboutAttachment,
  toReadableEmail,
  type CallInReadableEmail,
} from "@/lib/call-in/assistant";
import { answerCallInQuestion, demoMailboxSnapshot } from "@/lib/call-in/assistant";

describe("attachment metadata from Gmail MIME", () => {
  it("collects filename, mimeType, size, attachmentId", () => {
    const meta = extractGmailAttachmentMeta({
      mimeType: "multipart/mixed",
      parts: [
        {
          mimeType: "text/plain",
          body: { data: Buffer.from("hi").toString("base64url") },
        },
        {
          filename: "agenda.pdf",
          mimeType: "application/pdf",
          body: { attachmentId: "ATT123", size: 4096 },
        },
        {
          filename: "notes.txt",
          mimeType: "text/plain",
          body: { attachmentId: "ATT456", size: 120 },
        },
      ],
    });
    expect(meta).toEqual([
      {
        filename: "agenda.pdf",
        mimeType: "application/pdf",
        size: 4096,
        attachmentId: "ATT123",
      },
      {
        filename: "notes.txt",
        mimeType: "text/plain",
        size: 120,
        attachmentId: "ATT456",
      },
    ]);
  });

  it("skips body parts without filename or attachmentId", () => {
    const meta = extractGmailAttachmentMeta({
      mimeType: "text/plain",
      body: { data: Buffer.from("body only").toString("base64url") },
    });
    expect(meta).toEqual([]);
  });
});

describe("attachment text extractors", () => {
  it("reads plain text", async () => {
    const result = await extractAttachmentText({
      mimeType: "text/plain",
      filename: "hello.txt",
      bytes: Buffer.from("Hello from the attachment."),
    });
    expect(result.status).toBe("ok");
    expect(result.text).toMatch(/Hello from the attachment/);
    expect(result.speakableType).toBe("text file");
  });

  it("strips HTML", async () => {
    const result = await extractAttachmentText({
      mimeType: "text/html",
      filename: "page.html",
      bytes: Buffer.from("<p>Invoice <b>due</b> Friday</p>"),
    });
    expect(result.status).toBe("ok");
    expect(result.text).toMatch(/Invoice due Friday/);
  });

  it("refuses images without OCR when no key configured", async () => {
    const result = await extractAttachmentText({
      mimeType: "image/png",
      filename: "scan.png",
      bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    });
    expect(result.status).toBe("image_no_ocr");
    expect(result.text).toBe("");
    expect(result.reason).toMatch(/can't read the picture text yet|note the filename/i);
  });

  it("flags oversized files", async () => {
    const result = await extractAttachmentText({
      mimeType: "text/plain",
      filename: "huge.txt",
      bytes: Buffer.from("x"),
      byteLength: MAX_ATTACHMENT_BYTES + 1,
    });
    expect(result.status).toBe("too_large");
    expect(result.reason).toMatch(/too large/i);
  });

  it("extracts simple PDF text strings", () => {
    // Minimal-ish PDF with a literal text string in a stream
    const pdf = Buffer.from(
      `%PDF-1.1
1 0 obj<<>>endobj
2 0 obj<< /Length 44 >>stream
BT /F1 12 Tf (Quarterly report ready) Tj ET
endstream
endobj
trailer<<>>
%%EOF`,
      "latin1",
    );
    const text = extractPdfPlainText(pdf);
    expect(text).toMatch(/Quarterly report ready/);
  });

  it("slices TTS chunks with hasMore", () => {
    const long = Array.from({ length: 80 }, (_, i) => `chunk${i}`).join(" ");
    const first = sliceAttachmentTextForSpeech(long, 0, 40);
    expect(first.spoken.length).toBeLessThanOrEqual(40);
    expect(first.hasMore).toBe(true);
    const second = sliceAttachmentTextForSpeech(long, first.nextOffset, 40);
    expect(second.spoken).not.toBe(first.spoken);
    expect(second.spoken).toMatch(/chunk/);
  });

  it("labels speakable types", () => {
    expect(speakableAttachmentType("application/pdf", "a.pdf")).toBe("PDF");
    expect(
      speakableAttachmentType(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "a.docx",
      ),
    ).toBe("Word document");
    expect(
      speakableAttachmentType(
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "deck.pptx",
      ),
    ).toBe("PowerPoint");
  });

  it("extracts PPTX slide text in order with slide labels", async () => {
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    const slideXml = (title: string, body: string) =>
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
 xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree>
    <p:sp><p:txBody><a:p><a:r><a:t>${title}</a:t></a:r></a:p>
      <a:p><a:r><a:t>${body}</a:t></a:r></a:p></p:txBody></p:sp>
  </p:spTree></p:cSld>
</p:sld>`;
    // Intentionally add slide 2 before slide 1 in the zip to prove numeric ordering
    zip.file("ppt/slides/slide2.xml", slideXml("Budget", "Q3 forecast"));
    zip.file("ppt/slides/slide1.xml", slideXml("Agenda", "Welcome &amp; overview"));
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>`,
    );
    const bytes = Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));

    const result = await extractAttachmentText({
      mimeType:
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      filename: "weekly.pptx",
      bytes,
    });
    expect(result.status).toBe("ok");
    expect(result.speakableType).toBe("PowerPoint");
    expect(result.text).toMatch(/^Slide 1\. Agenda Welcome & overview/);
    expect(result.text).toMatch(/Slide 2\. Budget Q3 forecast/);
    // Slide 1 content must appear before Slide 2
    expect(result.text.indexOf("Slide 1.")).toBeLessThan(
      result.text.indexOf("Slide 2."),
    );
  });

  it("rejects legacy .ppt with a clear pptx-only message", async () => {
    const result = await extractAttachmentText({
      mimeType: "application/vnd.ms-powerpoint",
      filename: "old.ppt",
      bytes: Buffer.from("MSCF-not-a-real-ppt"),
    });
    expect(result.status).toBe("unsupported");
    expect(result.speakableType).toBe("PowerPoint");
    expect(result.reason).toMatch(/\.pptx/i);
    expect(result.reason).toMatch(/not older \.ppt/i);
  });
});

describe("attachment speech formatting", () => {
  it("announces count, name, type, and contents", () => {
    const spoken = formatAttachmentsForSpeech([
      {
        filename: "agenda.pdf",
        mimeType: "application/pdf",
        size: 1000,
        speakableType: "PDF",
        status: "ok",
        readableText: "Meeting at noon in the library.",
        remainingText: "",
      },
      {
        filename: "photo.png",
        mimeType: "image/png",
        size: 2000,
        speakableType: "image",
        status: "image_no_ocr",
        readableText: "",
        remainingText: "",
        reason:
          "This is an image — I can note the filename, but I can't read the picture text yet.",
      },
    ]);
    expect(spoken).toMatch(/This email has 2 attachments/i);
    expect(spoken).toMatch(/Attachment 1: agenda\.pdf, PDF/i);
    expect(spoken).toMatch(/Contents: Meeting at noon/i);
    expect(spoken).toMatch(/Attachment 2: photo\.png, image/i);
    expect(spoken).toMatch(/can't read the picture text yet/i);
  });

  it("announces attachments after body without reading contents", () => {
    const email: CallInReadableEmail = {
      fromAddress: "Jordan <j@example.com>",
      subject: "Docs",
      readableText: "Please see the attached agenda.",
      contentSource: "body",
      attachments: [
        {
          filename: "agenda.pdf",
          mimeType: "application/pdf",
          size: 500,
          speakableType: "PDF",
          status: "ok",
          readableText: "Agenda item one.",
          remainingText: "",
        },
      ],
    };
    const line = formatReadableEmailForSpeech(email, 1, 1);
    expect(line).toMatch(/Message: Please see the attached agenda/i);
    expect(line).toMatch(/This email has 1 attachment/i);
    expect(line).toMatch(/agenda\.pdf, PDF/i);
    expect(line).toMatch(/read it in full.*extractive summary.*skip/i);
    expect(line).not.toMatch(/Agenda item one/i);
  });

  it("reads a short attachment all the way through in one turn", () => {
    const spoken = formatAttachmentsForSpeech([
      {
        filename: "long.txt",
        mimeType: "text/plain",
        size: 5000,
        speakableType: "text file",
        status: "ok",
        readableText: "First chunk.",
        remainingText: "Second chunk continues here.",
      },
    ]);
    expect(spoken).toMatch(/First chunk\. Second chunk continues here\./);
    expect(spoken).not.toMatch(/words remain/i);
  });

  it("offers continuation when a file is longer than one turn", () => {
    const fullText = Array.from(
      { length: 60 },
      (_, i) => `Line ${i + 1} of the quarterly report explains the numbers.`,
    ).join(" ");
    const spoken = formatAttachmentsForSpeech(
      [
        {
          filename: "report.txt",
          mimeType: "text/plain",
          size: fullText.length,
          speakableType: "text file",
          status: "ok",
          readableText: fullText.slice(0, 400),
          remainingText: fullText.slice(400),
          fullText,
        },
      ],
      { maxAttachmentTextChars: 600, budgetChars: 900 },
    );
    expect(spoken).toMatch(/There is more of report\.txt/i);
    expect(spoken).toMatch(/words remain/i);
    expect(spoken).toMatch(/Say continue to hear the rest/i);
    expect(spoken).toMatch(/say next to skip/i);
  });

  it("speakMoreAboutAttachment continues remaining text", () => {
    const emails: CallInReadableEmail[] = [
      {
        fromAddress: "a@b.com",
        subject: "Hi",
        readableText: "Body",
        contentSource: "body",
        attachments: [
          {
            filename: "long.txt",
            mimeType: "text/plain",
            size: 100,
            speakableType: "text file",
            status: "ok",
            readableText: "First.",
            remainingText: "Second part of the file.",
          },
        ],
      },
    ];
    const spoken = speakMoreAboutAttachment(emails);
    expect(spoken).toMatch(/Continuing long\.txt/i);
    expect(spoken).toMatch(/Second part of the file/i);
  });

  it("toReadableEmail carries attachments", () => {
    const email = toReadableEmail({
      fromAddress: "a@b.com",
      subject: "Hi",
      bodyText: "Body",
      attachments: [
        {
          filename: "a.txt",
          mimeType: "text/plain",
          size: 10,
          speakableType: "text file",
          status: "ok",
          readableText: "x",
          remainingText: "",
        },
      ],
    });
    expect(email.attachments).toHaveLength(1);
  });

  it("say more about this attachment intent", () => {
    const snap = demoMailboxSnapshot("Alex");
    snap.readableEmails[0]!.attachments = [
      {
        filename: "notes.txt",
        mimeType: "text/plain",
        size: 50,
        speakableType: "text file",
        status: "ok",
        readableText: "Part one.",
        remainingText: "Part two of the notes.",
      },
    ];
    const a = answerCallInQuestion("Say more about this attachment", snap);
    expect(a.intent).toBe("attachment_more");
    expect(a.spoken).toMatch(/Part two of the notes/i);
  });
});

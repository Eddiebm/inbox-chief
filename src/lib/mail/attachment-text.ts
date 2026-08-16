/**
 * Extract speakable text from email attachment bytes.
 * Never invents content. Images / scanned PDFs: OCR when configured, else clear stub.
 * Caps length for TTS; callers may offer “say more”.
 */

import { inflateRawSync, inflateSync } from "zlib";
import { ocrImageBytes, speakOcrUnavailable } from "@/lib/mail/ocr";

export const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024; // 2 MiB fetch cap
/** Default first TTS chunk = Standard tier (tighter). Premium passes a larger max. */
export const MAX_ATTACHMENT_TEXT_CHARS = 480;
export const MAX_ATTACHMENTS_PER_EMAIL = 5;

export type AttachmentExtractStatus =
  | "ok"
  | "empty"
  | "too_large"
  | "unsupported"
  | "image_no_ocr"
  | "ocr_ok"
  | "encrypted_or_unreadable"
  | "error";

export type AttachmentTextResult = {
  status: AttachmentExtractStatus;
  /** Full extracted text (may be long); speech uses a truncated slice */
  text: string;
  reason?: string;
  speakableType: string;
};

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function stripHtmlToText(html: string): string {
  return normalizeWhitespace(
    html
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'"),
  );
}

/** Human-friendly type label for TTS (plain language). */
export function speakableAttachmentType(
  mimeType: string,
  filename?: string | null,
): string {
  const mime = (mimeType || "").toLowerCase();
  const name = (filename || "").toLowerCase();
  if (mime === "application/pdf" || name.endsWith(".pdf")) return "PDF";
  if (
    mime.includes("wordprocessingml") ||
    mime === "application/msword" ||
    name.endsWith(".docx") ||
    name.endsWith(".doc")
  ) {
    return "Word document";
  }
  if (
    mime.includes("presentationml") ||
    mime === "application/vnd.ms-powerpoint" ||
    name.endsWith(".pptx") ||
    name.endsWith(".ppt")
  ) {
    return "PowerPoint";
  }
  if (mime === "text/plain" || name.endsWith(".txt")) return "text file";
  if (mime === "text/html" || name.endsWith(".html") || name.endsWith(".htm")) {
    return "HTML file";
  }
  if (mime === "text/csv" || name.endsWith(".csv")) return "CSV file";
  if (mime.startsWith("text/")) return "text file";
  if (mime.startsWith("image/")) return "image";
  if (mime.includes("spreadsheet") || name.endsWith(".xlsx")) {
    return "spreadsheet";
  }
  if (mime) return mime.split("/").pop() || "file";
  return "file";
}

export function isImageMime(mimeType: string): boolean {
  return (mimeType || "").toLowerCase().startsWith("image/");
}

export function isSupportedTextAttachment(
  mimeType: string,
  filename?: string | null,
): boolean {
  const mime = (mimeType || "").toLowerCase();
  const name = (filename || "").toLowerCase();
  if (isImageMime(mime)) return false;
  if (
    mime === "application/pdf" ||
    name.endsWith(".pdf") ||
    mime.includes("wordprocessingml") ||
    name.endsWith(".docx") ||
    mime.includes("presentationml") ||
    name.endsWith(".pptx") ||
    mime === "text/plain" ||
    mime === "text/html" ||
    mime === "text/csv" ||
    mime.startsWith("text/") ||
    name.endsWith(".txt") ||
    name.endsWith(".html") ||
    name.endsWith(".htm") ||
    name.endsWith(".csv") ||
    name.endsWith(".md")
  ) {
    return true;
  }
  // Legacy .doc / .ppt are not reliably extractable without heavy libs
  if (mime === "application/msword" || name.endsWith(".doc")) return false;
  if (mime === "application/vnd.ms-powerpoint" || isLegacyPptFilename(name)) {
    return false;
  }
  return false;
}

function isLegacyPptFilename(name: string): boolean {
  return name.endsWith(".ppt") && !name.endsWith(".pptx");
}

/** Slice text for first TTS pass; remaining used for “say more”. */
export function sliceAttachmentTextForSpeech(
  fullText: string,
  startOffset = 0,
  maxChars = MAX_ATTACHMENT_TEXT_CHARS,
): { spoken: string; nextOffset: number; hasMore: boolean } {
  const cleaned = normalizeWhitespace(fullText);
  if (!cleaned) {
    return { spoken: "", nextOffset: 0, hasMore: false };
  }
  const start = Math.max(0, Math.min(startOffset, cleaned.length));
  const slice = cleaned.slice(start, start + maxChars);
  const nextOffset = start + slice.length;
  const hasMore = nextOffset < cleaned.length;
  return {
    spoken: slice,
    nextOffset,
    hasMore,
  };
}

/**
 * Extract plain text from attachment bytes. Never invents content.
 */
export async function extractAttachmentText(input: {
  mimeType: string;
  filename?: string | null;
  bytes: Buffer;
  byteLength?: number;
}): Promise<AttachmentTextResult> {
  const mime = (input.mimeType || "application/octet-stream").toLowerCase();
  const filename = input.filename ?? null;
  const speakableType = speakableAttachmentType(mime, filename);
  const size = input.byteLength ?? input.bytes.byteLength;

  if (size > MAX_ATTACHMENT_BYTES) {
    return {
      status: "too_large",
      text: "",
      speakableType,
      reason: `This ${speakableType} is too large to read on the phone (over 2 megabytes). I can note the filename.`,
    };
  }

  if (isImageMime(mime)) {
    const ocr = await ocrImageBytes({
      bytes: input.bytes,
      mimeType: mime,
      filename,
    });
    if (ocr?.text) {
      return {
        status: "ocr_ok",
        text: ocr.text,
        speakableType,
        reason: undefined,
      };
    }
    return {
      status: "image_no_ocr",
      text: "",
      speakableType,
      reason: speakOcrUnavailable(speakableType),
    };
  }

  const lowerName = (filename ?? "").toLowerCase();
  if (
    mime === "application/vnd.ms-powerpoint" ||
    isLegacyPptFilename(lowerName)
  ) {
    return {
      status: "unsupported",
      text: "",
      speakableType,
      reason:
        "I can only read modern PowerPoint files ending in .pptx, not older .ppt files. I can note the filename.",
    };
  }

  if (!isSupportedTextAttachment(mime, filename)) {
    return {
      status: "unsupported",
      text: "",
      speakableType,
      reason: `I can't extract text from this ${speakableType} yet. I can note the filename.`,
    };
  }

  try {
    if (
      mime === "application/pdf" ||
      lowerName.endsWith(".pdf")
    ) {
      const text = extractPdfPlainText(input.bytes);
      if (text) {
        return { status: "ok", text, speakableType };
      }
      // Scanned / image-only PDF — try OCR on the bytes (best-effort)
      const ocr = await ocrImageBytes({
        bytes: input.bytes,
        mimeType: "application/pdf",
        filename: filename ?? "scan.pdf",
      });
      if (ocr?.text) {
        return {
          status: "ocr_ok",
          text: ocr.text,
          speakableType,
        };
      }
      return {
        status: "encrypted_or_unreadable",
        text: "",
        speakableType,
        reason:
          "I couldn't extract text from this PDF — it may be scanned or image-only. I can note the filename.",
      };
    }

    if (
      mime.includes("wordprocessingml") ||
      lowerName.endsWith(".docx")
    ) {
      const text = await extractDocxPlainText(input.bytes);
      if (!text) {
        return {
          status: "empty",
          text: "",
          speakableType,
          reason:
            "This Word document had no readable text. I can note the filename.",
        };
      }
      return { status: "ok", text, speakableType };
    }

    if (
      mime.includes("presentationml") ||
      lowerName.endsWith(".pptx")
    ) {
      const text = await extractPptxPlainText(input.bytes);
      if (!text) {
        return {
          status: "empty",
          text: "",
          speakableType,
          reason:
            "This PowerPoint had no readable text. I can note the filename.",
        };
      }
      return { status: "ok", text, speakableType };
    }

    if (mime === "text/html" || lowerName.endsWith(".html") || lowerName.endsWith(".htm")) {
      const text = stripHtmlToText(input.bytes.toString("utf8"));
      if (!text) {
        return {
          status: "empty",
          text: "",
          speakableType,
          reason: "This HTML file had no readable text. I can note the filename.",
        };
      }
      return { status: "ok", text, speakableType };
    }

    // Plain text / csv / markdown / other text/*
    const text = normalizeWhitespace(input.bytes.toString("utf8"));
    if (!text) {
      return {
        status: "empty",
        text: "",
        speakableType,
        reason: `This ${speakableType} was empty. I can note the filename.`,
      };
    }
    return { status: "ok", text, speakableType };
  } catch {
    return {
      status: "error",
      text: "",
      speakableType,
      reason: `I ran into a problem reading this ${speakableType}. I can note the filename.`,
    };
  }
}

/** Lightweight PDF text-layer extraction (no OCR). */
export function extractPdfPlainText(bytes: Buffer): string {
  const raw = bytes.toString("latin1");
  if (/\/Encrypt\b/.test(raw)) {
    return "";
  }

  const chunks: string[] = [];

  // Prefer FlateDecode streams (most text PDFs)
  const streamRe = /stream\r?\n([\s\S]*?)endstream/g;
  let match: RegExpExecArray | null;
  while ((match = streamRe.exec(raw)) !== null) {
    const payload = match[1];
    if (!payload) continue;
    // Drop leading newline noise from stream boundary
    let data = Buffer.from(payload.replace(/^\r?\n/, ""), "latin1");
    try {
      // Try raw inflate then zlib wrap
      let inflated: Buffer;
      try {
        inflated = inflateRawSync(data);
      } catch {
        inflated = inflateSync(data);
      }
      const text = collectPdfStrings(inflated.toString("latin1"));
      if (text) chunks.push(text);
    } catch {
      // Uncompressed stream or binary image — try literal strings in payload
      const text = collectPdfStrings(payload);
      if (text) chunks.push(text);
    }
  }

  if (chunks.length === 0) {
    const fallback = collectPdfStrings(raw);
    if (fallback) chunks.push(fallback);
  }

  return normalizeWhitespace(chunks.join(" "));
}

function collectPdfStrings(content: string): string {
  const out: string[] = [];
  // Parentheses strings: (Hello \(world\))
  const parenRe = /\((?:\\.|[^\\)])*\)/g;
  let m: RegExpExecArray | null;
  while ((m = parenRe.exec(content)) !== null) {
    const inner = m[0].slice(1, -1);
    const decoded = inner
      .replace(/\\n/g, " ")
      .replace(/\\r/g, " ")
      .replace(/\\t/g, " ")
      .replace(/\\\(/g, "(")
      .replace(/\\\)/g, ")")
      .replace(/\\\\/g, "\\")
      .replace(/\\([0-7]{1,3})/g, (_, oct: string) =>
        String.fromCharCode(parseInt(oct, 8)),
      );
    if (decoded.trim()) out.push(decoded);
  }
  // Hex strings: <48656C6C6F>
  const hexRe = /<([0-9A-Fa-f\s]+)>/g;
  while ((m = hexRe.exec(content)) !== null) {
    const hex = (m[1] ?? "").replace(/\s+/g, "");
    if (hex.length < 4 || hex.length % 2 !== 0) continue;
    try {
      const decoded = Buffer.from(hex, "hex").toString("utf8");
      if (/^[\x20-\x7E\s]+$/.test(decoded) && decoded.trim()) {
        out.push(decoded);
      }
    } catch {
      // ignore bad hex
    }
  }
  return normalizeWhitespace(out.join(" "));
}

async function extractDocxPlainText(bytes: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer: bytes });
  return normalizeWhitespace(result.value ?? "");
}

/**
 * PPTX is OOXML (zip). Read `ppt/slides/slideN.xml` in numeric order and
 * collect DrawingML text runs (`<a:t>`), labeling each slide for speech.
 */
async function extractPptxPlainText(bytes: Buffer): Promise<string> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(bytes);
  const slidePaths = Object.keys(zip.files)
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/i.test(path))
    .sort((a, b) => slideNumberFromPath(a) - slideNumberFromPath(b));

  const parts: string[] = [];
  for (const path of slidePaths) {
    const file = zip.file(path);
    if (!file) continue;
    const xml = await file.async("string");
    const slideText = extractDrawingMlText(xml);
    if (!slideText) continue;
    const n = slideNumberFromPath(path);
    parts.push(`Slide ${n}. ${slideText}`);
  }
  return normalizeWhitespace(parts.join(" "));
}

function slideNumberFromPath(path: string): number {
  const match = /slide(\d+)\.xml$/i.exec(path);
  return match ? Number(match[1]) : 0;
}

/** Pull plain text from OOXML DrawingML `<a:t>` runs; decode common entities. */
function extractDrawingMlText(xml: string): string {
  const runs: string[] = [];
  const re = /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml)) !== null) {
    const decoded = decodeXmlEntities(match[1] ?? "");
    if (decoded.trim()) runs.push(decoded);
  }
  return normalizeWhitespace(runs.join(" "));
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) =>
      String.fromCharCode(Number(n)),
    )
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) =>
      String.fromCharCode(parseInt(h, 16)),
    )
    .replace(/&amp;/g, "&");
}

/**
 * Pragmatic OCR for call-in attachments (images + image-only PDFs).
 *
 * Prefer cloud when a key exists (OCR.space or Google Vision).
 * Otherwise return null so callers speak a clear filename-only stub —
 * never invent text.
 */

export type OcrProvider = "ocr_space" | "google_vision" | "none";

export type OcrResult = {
  text: string;
  provider: Exclude<OcrProvider, "none">;
};

function normalizeOcrText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Which OCR backend is configured (for operator checklist / docs). */
export function resolveOcrProvider(): OcrProvider {
  if (process.env.OCR_SPACE_API_KEY?.trim()) return "ocr_space";
  if (
    process.env.GOOGLE_VISION_API_KEY?.trim() ||
    process.env.GOOGLE_CLOUD_VISION_API_KEY?.trim()
  ) {
    return "google_vision";
  }
  return "none";
}

export function isOcrConfigured(): boolean {
  return resolveOcrProvider() !== "none";
}

/**
 * Run OCR on image bytes. Returns null when no provider is configured
 * or the provider fails / returns empty.
 */
export async function ocrImageBytes(input: {
  bytes: Buffer;
  mimeType: string;
  filename?: string | null;
}): Promise<OcrResult | null> {
  const provider = resolveOcrProvider();
  if (provider === "none") return null;

  try {
    if (provider === "ocr_space") {
      const text = await ocrViaOcrSpace(input.bytes, input.mimeType, input.filename);
      if (!text) return null;
      return { text, provider: "ocr_space" };
    }
    if (provider === "google_vision") {
      const text = await ocrViaGoogleVision(input.bytes);
      if (!text) return null;
      return { text, provider: "google_vision" };
    }
  } catch (err) {
    console.warn("[ocr] provider failed", provider, err);
  }
  return null;
}

async function ocrViaOcrSpace(
  bytes: Buffer,
  mimeType: string,
  filename?: string | null,
): Promise<string> {
  const apiKey = process.env.OCR_SPACE_API_KEY!.trim();
  const form = new FormData();
  const name = filename?.trim() || `scan.${mimeToExt(mimeType)}`;
  const blob = new Blob([new Uint8Array(bytes)], { type: mimeType || "image/png" });
  form.append("file", blob, name);
  form.append("language", "eng");
  form.append("isOverlayRequired", "false");
  form.append("OCREngine", "2");
  form.append("scale", "true");

  const res = await fetch("https://api.ocr.space/parse/image", {
    method: "POST",
    headers: { apikey: apiKey },
    body: form,
  });
  if (!res.ok) {
    console.warn("[ocr] OCR.space HTTP", res.status);
    return "";
  }
  const data = (await res.json()) as {
    IsErroredOnProcessing?: boolean;
    ErrorMessage?: string | string[];
    ParsedResults?: Array<{ ParsedText?: string }>;
  };
  if (data.IsErroredOnProcessing) {
    console.warn("[ocr] OCR.space error", data.ErrorMessage);
    return "";
  }
  const text = (data.ParsedResults ?? [])
    .map((r) => r.ParsedText ?? "")
    .join(" ");
  return normalizeOcrText(text);
}

async function ocrViaGoogleVision(bytes: Buffer): Promise<string> {
  const apiKey =
    process.env.GOOGLE_VISION_API_KEY?.trim() ||
    process.env.GOOGLE_CLOUD_VISION_API_KEY?.trim();
  if (!apiKey) return "";

  const res = await fetch(
    `https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [
          {
            image: { content: bytes.toString("base64") },
            features: [{ type: "TEXT_DETECTION", maxResults: 1 }],
          },
        ],
      }),
    },
  );
  if (!res.ok) {
    console.warn("[ocr] Google Vision HTTP", res.status);
    return "";
  }
  const data = (await res.json()) as {
    responses?: Array<{
      fullTextAnnotation?: { text?: string };
      textAnnotations?: Array<{ description?: string }>;
      error?: { message?: string };
    }>;
  };
  const first = data.responses?.[0];
  if (first?.error?.message) {
    console.warn("[ocr] Google Vision error", first.error.message);
    return "";
  }
  const text =
    first?.fullTextAnnotation?.text ||
    first?.textAnnotations?.[0]?.description ||
    "";
  return normalizeOcrText(text);
}

function mimeToExt(mime: string): string {
  const m = (mime || "").toLowerCase();
  if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
  if (m.includes("png")) return "png";
  if (m.includes("webp")) return "webp";
  if (m.includes("gif")) return "gif";
  if (m.includes("pdf")) return "pdf";
  return "bin";
}

/** Spoken stub when OCR is unavailable — plain language, no operator jargon. */
export function speakOcrUnavailable(speakableType: string): string {
  return `This is a ${speakableType} — I can note the filename, but I can't read the picture text yet.`;
}

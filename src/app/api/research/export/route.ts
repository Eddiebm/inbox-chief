import { NextResponse } from "next/server";
import { requireResearchScope } from "@/lib/research/http";
import { researchStore } from "@/lib/research/runtime";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireResearchScope();
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  const bundle = await researchStore().exportBundle(auth.scope, url.searchParams.get("projectId") || undefined);
  if (url.searchParams.get("format") === "md") {
    const markdown = renderMarkdown(bundle);
    return new NextResponse(markdown, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": "attachment; filename=inbox-chief-research.md",
      },
    });
  }
  return NextResponse.json(bundle, {
    headers: { "Content-Disposition": "attachment; filename=inbox-chief-research.json" },
  });
}

function renderMarkdown(bundle: Awaited<ReturnType<ReturnType<typeof researchStore>["exportBundle"]>>): string {
  const lines = ["# Inbox Chief research export", "", `Exported: ${bundle.exportedAt}`, ""];
  for (const session of bundle.sessions) {
    const project = bundle.projects.find((item) => item.id === session.projectId);
    lines.push(`## ${session.title}`, "", `Project: ${project?.name ?? "Unknown"}`, `Started: ${session.createdAt}`, "");
    const records = bundle.records.filter((record) => record.sessionId === session.id).sort((a, b) => a.sequence - b.sequence);
    for (const record of records) {
      const who = record.speaker === "OWNER" ? "You" : record.speaker === "ASSISTANT" ? "Assistant" : "System";
      lines.push(`### ${who} — ${record.kind}`, "", record.text, "");
      if (record.correctedText) lines.push(`Corrected text: ${record.correctedText}`, "", "Original transcript kept above.", "");
    }
    const sources = bundle.sources.filter((source) => source.sessionId === session.id);
    if (sources.length) {
      lines.push("### Sources", "");
      for (const source of sources) {
        lines.push(`- ${source.title} (${source.accessLevel}) ${source.url}`);
      }
      lines.push("");
    }
  }
  return lines.join("\n");
}

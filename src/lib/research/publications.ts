import { RESEARCH_LIMITS } from "@/lib/research/policy";
import type { AccessLevel, ResearchSource } from "@/lib/research/types";

export type PublicationHit = Omit<ResearchSource, "id" | "sessionId">;

type EuropePmcResult = {
  title?: string;
  authorString?: string;
  authorList?: { author?: Array<{ fullName?: string }> | { fullName?: string } };
  pubYear?: string;
  doi?: string;
  pmid?: string;
  pmcid?: string;
  abstractText?: string;
  isOpenAccess?: string;
  fullTextUrlList?: { fullTextUrl?: Array<{ url?: string }> | { url?: string } };
};

function asArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'");
}

function stripTags(value: string): string {
  const decoded = decodeEntities(value);
  return decodeEntities(decoded.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

export function parseEuropePmcPayload(payload: unknown, retrievedAt: string): PublicationHit[] {
  const root = payload as { resultList?: { result?: EuropePmcResult[] | EuropePmcResult } };
  const results = asArray(root.resultList?.result);
  return results.slice(0, RESEARCH_LIMITS.maxSources).map((item) => {
    const authorsFromList = asArray(item.authorList?.author)
      .map((author) => author.fullName?.trim())
      .filter((name): name is string => Boolean(name));
    const authors = item.authorString?.trim() || authorsFromList.join(", ");
    const urls = asArray(item.fullTextUrlList?.fullTextUrl)
      .map((entry) => entry.url?.trim())
      .filter((url): url is string => Boolean(url));
    const pmid = item.pmid?.trim() || null;
    const doi = item.doi?.trim() || null;
    const abstract = item.abstractText ? stripTags(item.abstractText) : "";
    const url = urls[0] || (pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : doi ? `https://doi.org/${doi}` : "");
    let accessLevel: AccessLevel = "INACCESSIBLE";
    let excerpt = "";
    if (abstract) {
      accessLevel = "ABSTRACT";
      excerpt = abstract.slice(0, 4000);
    } else if (item.title) {
      accessLevel = "SNIPPET";
      excerpt = "No abstract was included in the retrieved record.";
    }
    return {
      title: stripTags(item.title || "Untitled record"),
      authors,
      published: item.pubYear?.trim() || null,
      url,
      doi,
      pmid,
      pmcid: item.pmcid?.trim() || null,
      retrievedAt,
      accessLevel,
      excerpt,
    };
  });
}

export function extractJatsText(xml: string): string {
  const body = xml.match(/<body[\s\S]*?<\/body>/i)?.[0] ?? xml;
  return stripTags(body).slice(0, 6000);
}

export function accessLabel(level: AccessLevel): string {
  switch (level) {
    case "FULL_TEXT":
      return "Full text retrieved";
    case "ABSTRACT":
      return "Abstract only";
    case "SNIPPET":
      return "Search snippet only";
    case "INACCESSIBLE":
      return "Full text and abstract were not accessible";
    default: {
      const never: never = level;
      return never;
    }
  }
}

export function guardExplanation(text: string, sources: Array<{ accessLevel: AccessLevel }>): string {
  const claimsFull = /\b(full paper|full text|entire paper|i read the paper)\b/i.test(text);
  const anyFull = sources.some((source) => source.accessLevel === "FULL_TEXT");
  if (claimsFull && !anyFull) {
    return `${text}\n\nCorrection: I do not have the full text of these papers. What I retrieved is an abstract, a snippet, or an inaccessible record.`;
  }
  return text;
}

export async function searchEuropePmc(
  query: string,
  fetchImpl: typeof fetch = fetch,
  now: Date = new Date(),
): Promise<PublicationHit[]> {
  const retrievedAt = now.toISOString();
  const run = async (q: string) => {
    const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(q)}&format=json&pageSize=${RESEARCH_LIMITS.maxSources}&resultType=core`;
    const response = await fetchImpl(url, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`europepmc_http_${response.status}`);
    return parseEuropePmcPayload(await response.json(), retrievedAt);
  };

  let hits = await run(`(${query}) AND SRC:MED`);
  if (hits.length === 0) hits = await run(query);

  let fullTextReads = 0;
  for (const hit of hits) {
    if (fullTextReads >= RESEARCH_LIMITS.maxFullText) break;
    if (!hit.pmcid) continue;
    fullTextReads += 1;
    try {
      const response = await fetchImpl(
        `https://www.ebi.ac.uk/europepmc/webservices/rest/${hit.pmcid}/fullTextXML`,
        { headers: { Accept: "application/xml" } },
      );
      if (!response.ok) continue;
      const text = extractJatsText(await response.text());
      if (text.length < 400) continue;
      hit.accessLevel = "FULL_TEXT";
      hit.excerpt = text.slice(0, 6000);
    } catch {
      // Keep the abstract-level record. A failed full-text fetch is not full text.
    }
  }
  return hits;
}

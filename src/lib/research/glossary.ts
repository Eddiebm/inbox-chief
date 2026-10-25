import type { GlossaryTerm } from "@/lib/research/types";

export const DEFAULT_GLOSSARY: Array<Omit<GlossaryTerm, "id">> = [
  { term: "DCLK1", spokenAs: "D C L K one", aliases: ["DCLK 1", "DCLK-1", "dclk1"] },
  { term: "olaparib", spokenAs: "oh-LAP-uh-rib", aliases: ["ola parib"] },
  { term: "CAR-T", spokenAs: "car tee", aliases: ["CAR T", "CART", "car-t"] },
  { term: "ADC", spokenAs: "A D C", aliases: ["antibody-drug conjugate", "antibody drug conjugate"] },
  { term: "CBT-611H", spokenAs: "C B T six one one H", aliases: ["CBT 611H", "CBT611H"] },
  { term: "isoform", spokenAs: "eye-so-form", aliases: ["isoforms"] },
];

export function levenshtein(a: string, b: string): number {
  const left = a.toLowerCase();
  const right = b.toLowerCase();
  const rows = Array.from({ length: left.length + 1 }, (_, i) => i);
  for (let j = 1; j <= right.length; j += 1) {
    let previous = rows[0] ?? 0;
    rows[0] = j;
    for (let i = 1; i <= left.length; i += 1) {
      const current = rows[i] ?? 0;
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      rows[i] = Math.min(current + 1, (rows[i - 1] ?? 0) + 1, previous + cost);
      previous = current;
    }
  }
  return rows[left.length] ?? 0;
}

function isExact(token: string, term: Omit<GlossaryTerm, "id">): boolean {
  const value = token.toLowerCase();
  if (value === term.term.toLowerCase()) return true;
  return term.aliases.some((alias) => alias.toLowerCase() === value);
}

export type UncertainTerm = { heard: string; canonical: string };

/**
 * Ask only when a token is a near-miss of a glossary term, which can change
 * the scientific question. Exact terms and known aliases pass through.
 */
export function findUncertainTerms(text: string, glossary: Array<Omit<GlossaryTerm, "id">>): UncertainTerm[] {
  const tokens = text.match(/[A-Za-z][A-Za-z0-9-]{2,}/g) ?? [];
  const found: UncertainTerm[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    if (glossary.some((term) => isExact(token, term))) continue;
    const candidates = glossary.filter((term) => {
      const distance = levenshtein(token, term.term.replace(/[^A-Za-z0-9]/g, ""));
      const raw = levenshtein(token, term.term);
      return Math.min(distance, raw) > 0 && Math.min(distance, raw) <= 2 && term.term.length >= 4;
    });
    if (candidates.length !== 1) continue;
    const canonical = candidates[0]?.term;
    if (!canonical || seen.has(token.toLowerCase())) continue;
    seen.add(token.toLowerCase());
    found.push({ heard: token, canonical });
  }
  return found;
}

export function applyTerm(question: string, heard: string, canonical: string): string {
  const pattern = new RegExp(`\\b${heard.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
  return question.replace(pattern, canonical);
}

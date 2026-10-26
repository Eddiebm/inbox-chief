/**
 * Deploy gate: production builds fail while any legal placeholder "[[...]]" remains in src/lib/legal.ts.
 * Runs only when VERCEL_ENV=production or LEGAL_GATE=1, so previews and local builds are unaffected.
 */
import { readFileSync } from "node:fs";

const enforce = process.env.VERCEL_ENV === "production" || process.env.LEGAL_GATE === "1";
const source = readFileSync(new URL("../src/lib/legal.ts", import.meta.url), "utf8");
const left = [...source.matchAll(/"\[\[([A-Z][^\]]*)\]\]"/g)].map((m) => m[1]);

if (left.length === 0) {
  console.log("check-legal: all legal facts are filled in.");
  process.exit(0);
}

const list = left.map((x) => `  - ${x}`).join("\n");
if (enforce) {
  console.error(`check-legal: BLOCKED. Replace these placeholders in src/lib/legal.ts before deploying to production:\n${list}`);
  process.exit(1);
}
console.warn(`check-legal: ${left.length} placeholder(s) remain (not enforced outside production):\n${list}`);

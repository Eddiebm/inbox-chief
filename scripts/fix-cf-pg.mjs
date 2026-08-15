import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * OpenNext copies an incomplete pg-cloudflare package (empty.js only).
 * Restore full dist/esm so the Workers bundle can resolve require("pg-cloudflare").
 */
const root = process.cwd();
const target = join(
  root,
  ".open-next/server-functions/default/node_modules/pg-cloudflare",
);
const source = join(root, "node_modules/pg-cloudflare");

if (!existsSync(target)) {
  console.log("pg-cloudflare target missing — skipping fix (build may have failed earlier).");
  process.exit(0);
}

for (const dir of ["dist", "esm"]) {
  const from = join(source, dir);
  const to = join(target, dir);
  if (!existsSync(from)) continue;
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to, { recursive: true });
  console.log(`Copied ${dir} → OpenNext pg-cloudflare`);
}

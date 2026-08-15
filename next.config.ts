import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

initOpenNextCloudflareForDev();

const root = path.dirname(fileURLToPath(import.meta.url));
/** Set by `npm run deploy:cf` so the Worker bundle never includes Prisma/pg. */
const workerBuild = process.env.OPEN_NEXT_WORKER === "1";
const dbNodeStubRel = "./src/lib/db-node.stub.ts";
const dbNodeRealRel = "./src/lib/db-node.ts";
const dbNodeStubAbs = path.join(root, "src/lib/db-node.stub.ts");
const dbNodeRealAbs = path.join(root, "src/lib/db-node.ts");

const nextConfig: NextConfig = {
  turbopack: {
    root: process.cwd(),
    resolveAlias: workerBuild
      ? {
          "@/lib/db-node": dbNodeStubRel,
        }
      : undefined,
  },
  webpack: (config) => {
    config.resolve = config.resolve ?? {};
    const target = workerBuild ? dbNodeStubAbs : dbNodeRealAbs;
    const aliases = {
      "@/lib/db-node": target,
      [dbNodeRealAbs]: target,
    };
    if (Array.isArray(config.resolve.alias)) {
      config.resolve.alias.push(
        ...Object.entries(aliases).map(([name, alias]) => ({ name, alias })),
      );
    } else {
      config.resolve.alias = {
        ...config.resolve.alias,
        ...aliases,
      };
    }
    return config;
  },
};

export default nextConfig;

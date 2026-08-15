# Cloudflare deployment notes

Inbox Chief is configured for Cloudflare Workers via OpenNext (`npm run deploy:cf`).

## Current status

| Step | Status |
|------|--------|
| Wrangler login | Done |
| `eddiebm.workers.dev` subdomain | Registered |
| OpenNext build | Succeeds |
| Workers deploy | **Live** (mock mode; Prisma stubbed out of Worker) |

| Host | URL |
|------|-----|
| Cloudflare Worker | https://inbox-chief.eddiebm.workers.dev |
| Vercel (Node + real DB path) | https://inbox-chief-kappa.vercel.app |

CF builds set `OPEN_NEXT_WORKER=1` so `@/lib/db-node` resolves to `db-node.stub.ts` (keeps Prisma/pg out of the Worker). Gzipped upload landed around **~1.0 MiB** after that (under the free **3 MiB** limit). Paid Workers raise the limit to **10 MiB** if you later need full Prisma on Workers (e.g. Hyperdrive).

## Redeploy

```bash
MOCK_INTEGRATIONS=true npm run deploy:cf
```

## Optional: Cloudflare DNS in front of Vercel

Point a custom domain’s CNAME at `cname.vercel-dns.com` (or the Vercel project domain) and proxy through Cloudflare (orange cloud) without hosting the Worker.

## Config files

- `wrangler.jsonc` — Worker name, `nodejs_compat`, minify, mock env vars
- `open-next.config.ts` — OpenNext Cloudflare adapter
- `next.config.ts` — `OPEN_NEXT_WORKER=1` aliases `db-node` → stub
- `src/lib/db-node.stub.ts` — Worker-safe DB stub
- `vendor/pg-cloudflare` — stub so Workers bundling resolves `pg`
- `src/middleware.ts` — Edge middleware (required by OpenNext; Next 16 `proxy.ts` is Node-only)

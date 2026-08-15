# Inbox Chief

**Inbox Chief** is a secure, AI-powered personal digital assistant for email. It helps busy people organize correspondence, generate drafts, and collaborate with assistants — without surrendering control of their inbox.

Human approval is required before any message is sent. Technical administrators do not receive mailbox access by default. Every data path is multi-tenant: `organizationId` + `workspaceId` (+ `mailboxId` where applicable).

## Product principles

- **Control stays with the owner** — drafts are suggestions; send only after approval
- **Accessible by design** — large type, high contrast, reduced motion, screen-reader-friendly onboarding, optional voice controls
- **Accountable** — audit logs for sensitive mailbox actions
- **Tenant-isolated** — queries must use `tenantWhere` / `assertTenantMatch`; never load rows by mailbox id alone
- **No silent training** — voice learning and personalization require explicit consent
- **Analytics opt-in** — product analytics is off by default; enable only from Settings

## Stack

- Next.js (App Router)
- Prisma 7 + PostgreSQL
- Stripe (billing stubs until keys are configured)
- Google Gmail OAuth (readonly + send scopes; never auto-send)

## Setup

1. **Install**

   ```bash
   npm install
   cp .env.example .env
   ```

2. **Configure** `.env` — at minimum set `DATABASE_URL` and `AUTH_SECRET`.

3. **Generate the Prisma client** (works with a placeholder `DATABASE_URL` if the DB is not up yet):

   ```bash
   npm run db:generate
   # or: DATABASE_URL="postgresql://u:p@localhost:5432/inbox_chief" npx prisma generate
   ```

4. **Migrate** (requires a reachable Postgres database):

   ```bash
   npm run db:migrate
   ```

5. **Seed** roles, permissions, plans, and industry templates:

   ```bash
   npm run db:seed
   ```

   Optional demo personas (separate orgs, fake `@example.com` emails — **not** production defaults):

   ```bash
   SEED_DEMO_PERSONAS=true npm run db:seed
   ```

6. **Run**

   ```bash
   npm run dev
   ```

Open [http://localhost:3000](http://localhost:3000).

### Tests

```bash
npm test
```

Cross-tenant isolation checks live in `tests/tenant-isolation.test.ts`.

## Accessibility

Onboarding and the dashboard target WCAG-minded defaults: text scaling, high contrast, reduced motion, large interface controls, and screen-reader-optimized copy. Prefer voice onboarding when users opt in. Avoid relying on color alone for urgency or status.

## Multi-tenant notes

| Concern | Pattern |
| -------- | -------- |
| Scope type | `TenantScope` in `src/lib/tenant.ts` |
| Assert access | `assertTenantMatch(scope, record)` |
| Prisma filters | `tenantWhere(scope)` / `mailboxTenantWhere(...)` |
| Sync jobs | Must pass `organizationId`, `workspaceId`, and `mailboxId` |
| RBAC | Roles/permissions in `src/lib/rbac.ts`; technical admin has `grantsMailboxAccessByDefault: false` |
| Audit | `writeAuditLog` requires org + workspace ids |

With `MOCK_INTEGRATIONS=true` (default in `.env.example`), Gmail and similar integrations return stubs without calling external APIs. Billing routes return `{ ok: false, reason: "stripe_not_configured" }` until `STRIPE_SECRET_KEY` is set.

## Call-in (VAPI)

Primary phone path is **VAPI** (Twilio voice remains a fallback). Production dial-in: **+1 (405) 716-9240**. See [docs/call-in.md](docs/call-in.md).

Webhook: `POST /api/call-in/vapi/webhook` · Setup: `npm run vapi:setup-call-in` (needs `VAPI_API_KEY`).

## Scripts

| Script | Purpose |
| ------ | ------- |
| `npm run dev` | Local Next.js server |
| `npm run build` / `start` | Production build |
| `npm run db:generate` | Prisma client generate |
| `npm run db:migrate` | Dev migrations |
| `npm run db:seed` | Seed RBAC, plans, templates |
| `npm run vapi:setup-call-in` | Create/update VAPI call-in assistant |
| `npm test` | Vitest |
| `npm run typecheck` | TypeScript |

## License

Private — all rights reserved.

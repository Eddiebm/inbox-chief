# Eddie — do this today (Inbox Chief production)

## ⚡ ONE-SHOT PATH (start here)

**→ [scripts/ONE-SHOT-DEPLOY.md](../scripts/ONE-SHOT-DEPLOY.md)**

1. Fill the seven `STRIPE_*` lines in `secrets.local.env` (optional if billing can wait)
2. Run `./scripts/bootstrap-production.sh`

Agent run **2026-08-17** already: generated `VAPI_WEBHOOK_SECRET`, patched VAPI assistant, applied Neon migrations, passed 394 tests. Vercel deploy needs your account login.

---

**Live:** https://www.inboxchief.email (apex `inboxchief.email` currently 308 → www)  
**Health:** https://www.inboxchief.email/api/health  
**Repo:** `main`

---

## Current production snapshot (before you deploy latest main)

| Check | Value |
| --- | --- |
| `database` | `ok` |
| `gmailOauthConfigured` | `true` |
| `googleOauthPublished` | `false` |
| `vapiNumberConfigured` | `true` |
| `vapiAssistantLinked` | `true` |
| `mockIntegrations` | `false` |
| `stripe.liveReady` | `false` |
| `vapiWebhookAuthConfigured` | *missing on current deploy* — new code requires it |

Production is on a **pre–fail-closed** deploy. Latest `main` returns 401 on every VAPI webhook without `VAPI_WEBHOOK_SECRET` in Vercel. The one-shot script sets it before `vercel --prod`.

---

## Detailed checklist (reference only)

<details>
<summary>Full manual steps if you prefer Vercel dashboard</summary>

### 1. Vercel domain (5 min)

Project **inbox-chief** → **Settings → Domains**

- Confirm `inboxchief.email` and `www.inboxchief.email` both show **Valid Configuration**
- **Flip redirect:** set **apex** (`inboxchief.email`) as Production; set **www** → **308 redirect to apex**

### 2. VAPI webhook secret

Already done by agent in VAPI dashboard + `secrets.local.env`. Just deploy via one-shot script.

### 3. Canonical URL env vars

Pre-filled in `secrets.local.env` / pushed by bootstrap script.

### 4. Session secrets

`AUTH_SECRET` generated in `secrets.local.env` — pushed by bootstrap script.

### 5. Google OAuth — test-user bridge (per patron)

See **[GOOGLE_OAUTH_PUBLISH.md](./GOOGLE_OAUTH_PUBLISH.md)** and the 10-click paste sheet
**[EDDIE_GOOGLE.md](./EDDIE_GOOGLE.md)**. Add patron Gmail as test user until Google approves.

### 6. Stripe live billing

See **[BILLING_GO_LIVE.md](./BILLING_GO_LIVE.md)**. Fill `STRIPE_*` in `secrets.local.env`.

### 7. VAPI assistant

Assistant `7adc3d95-5abb-4a82-adbe-2dec5628fa19` → `https://inboxchief.email/api/call-in/vapi/webhook` with `X-Vapi-Secret` header. Phone `+14057169240` assigned.

### 8. Deploy

Use `./scripts/bootstrap-production.sh` or Vercel dashboard redeploy after env vars are set.

### 9. Google verification submission (weeks)

Follow **[GOOGLE_OAUTH_PUBLISH.md](./GOOGLE_OAUTH_PUBLISH.md)**.

</details>

---

## Already done (no action)

- Neon: all 15 Prisma migrations applied
- Tests: 394/394 passing
- VAPI: server URL + `X-Vapi-Secret` header on assistant `7adc3d95-…`
- `VAPI_WEBHOOK_SECRET` + `AUTH_SECRET` in local `secrets.local.env` (gitignored)
- Bootstrap script: `scripts/bootstrap-production.sh`

---

## Can a blind patron register without you today?

**No** — not end-to-end.

| Step | Without operator? |
| --- | --- |
| Web signup `/signup` | **Yes** |
| Gmail connect | **No** — patron Gmail must be a Google **test user** until verification |
| Voice signup + provision link | **Partial** — account created, but same Gmail test-user gate |
| Paid checkout | **No** — Stripe live keys unset |
| Call-in reads mail | **Only** if Gmail already connected and phone registered |

**Short path:** add patron Gmail as test user → they sign up or call → connect Gmail → call **+1 (405) 716-9240**.

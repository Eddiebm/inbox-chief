# Eddie — do this today (Inbox Chief production)

Single ordered checklist. Everything here requires your Vercel account (`eddiebms-projects`) or an external dashboard. An agent run on **2026-08-17** completed everything else (tests, Neon migrations, VAPI assistant URL).

**Live:** https://www.inboxchief.email (apex `inboxchief.email` currently 308 → www)  
**Health:** https://www.inboxchief.email/api/health  
**Repo:** `main` @ `409e248`

---

## 0. Read the health snapshot (before you change anything)

Production health (both kappa and inboxchief.email) as of the last audit:

| Check | Value |
| --- | --- |
| `database` | `ok` |
| `gmailOauthConfigured` | `true` |
| `googleOauthPublished` | `false` |
| `vapiNumberConfigured` | `true` |
| `vapiAssistantLinked` | `true` |
| `mockIntegrations` | `false` |
| `stripe.liveReady` | `false` |

Production is still on a **pre–fail-closed** deploy (health JSON lacks `vapiWebhookAuthConfigured`). **Do not deploy latest `main` until step 2 is done** — new code returns 401 on every VAPI webhook without `VAPI_WEBHOOK_SECRET`.

---

## 1. Vercel domain (5 min)

Project **inbox-chief** → **Settings → Domains**

- [ ] Confirm `inboxchief.email` and `www.inboxchief.email` both show **Valid Configuration**
- [ ] **Flip redirect:** set **apex** (`inboxchief.email`) as Production; set **www** → **308 redirect to apex** (currently reversed: apex → www)
- [ ] After flip, verify: `curl -sI https://inboxchief.email/ | grep -i location` should **not** point at www

---

## 2. VAPI webhook secret — before any deploy (10 min)

Fail-closed webhook auth is in `main`. Call-in dies on deploy without this.

```bash
# Generate once (save output somewhere safe — do not commit)
openssl rand -hex 32
```

1. Vercel → **inbox-chief** → **Settings → Environment Variables** → Production **and** Preview:
   - `VAPI_WEBHOOK_SECRET` = *(paste output)*
2. VAPI dashboard → **Assistants** → *Inbox Chief — Anytime Call-in* → **Server URL**
   - URL: `https://inboxchief.email/api/call-in/vapi/webhook`
   - Custom header: `X-Vapi-Secret` = *(same value)*
3. Or re-run locally after adding to `.env`:
   ```bash
   VAPI_WEBHOOK_SECRET='…' npm run vapi:setup-call-in
   ```
4. **Then** redeploy Production. Confirm health shows `vapiWebhookAuthConfigured: true` and `ok: true`.

---

## 3. Canonical URL env vars (5 min)

Vercel → Production **and** Preview:

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_APP_URL` | `https://inboxchief.email` |
| `CALL_IN_PUBLIC_BASE_URL` | `https://inboxchief.email` |
| `GOOGLE_REDIRECT_URI` | `https://inboxchief.email/api/gmail/callback` |
| `MICROSOFT_REDIRECT_URI` | `https://inboxchief.email/api/outlook/callback` |

Redeploy after saving. Code defaults to `inboxchief.email` if unset, but OAuth providers and spoken URLs should match env.

---

## 4. Session secrets (5 min)

Only set if not already in Vercel (never paste placeholders):

```bash
openssl rand -hex 32   # AUTH_SECRET
# optional separate key:
openssl rand -hex 32   # TOKEN_ENCRYPTION_KEY
```

| Variable | Notes |
| --- | --- |
| `AUTH_SECRET` | Required in production — server refuses boot without a real value |
| `TOKEN_ENCRYPTION_KEY` | Optional; defaults to `AUTH_SECRET`. Do **not** rotate after patrons connect Gmail |

Confirm: `/api/health` → `sessionSecretsConfigured: true`

---

## 5. Google OAuth — test-user bridge (per patron, until verified)

Full verification checklist: **[GOOGLE_OAUTH_PUBLISH.md](./GOOGLE_OAUTH_PUBLISH.md)**

Quick path for each new patron Gmail:

1. [Audience → Test users](https://console.cloud.google.com/auth/audience?project=gen-lang-client-0169179372) → **Add users** → patron's exact Gmail
2. Inbox Chief → `/dashboard/admin/onboarding` → check **Gmail enabled for this patron**
3. Patron completes Google consent (Advanced → Continue to Inbox Chief)

**Console values (copy-paste):**

| Field | Value |
| --- | --- |
| Home page | `https://inboxchief.email` |
| Privacy | `https://inboxchief.email/privacy` |
| Terms | `https://inboxchief.email/terms` |
| Authorized domain | `inboxchief.email` |
| Redirect URI | `https://inboxchief.email/api/gmail/callback` |
| JS origins | `https://inboxchief.email` and `https://www.inboxchief.email` |

Keep `GOOGLE_OAUTH_PUBLISHED=false` until Google approves restricted scopes and a **brand-new** Gmail connects without a test-user row.

After approval only: `GOOGLE_OAUTH_PUBLISHED=true` → redeploy.

---

## 6. Stripe live billing (30 min)

Details: **[BILLING_GO_LIVE.md](./BILLING_GO_LIVE.md)**

Set all seven in Vercel Production:

- `STRIPE_SECRET_KEY` (`sk_live_…`)
- `STRIPE_WEBHOOK_SECRET` (`whsec_…`)
- `STRIPE_PRICE_PATRON`, `STRIPE_PRICE_PRO`
- `STRIPE_PRICE_MINUTES_30`, `STRIPE_PRICE_MINUTES_60`, `STRIPE_PRICE_MINUTES_120`

Webhook URL: `https://inboxchief.email/api/billing/webhook`

Verify: `/api/health` → `checks.stripe.liveReady: true`

---

## 7. VAPI assistant (already partially done)

Agent run updated assistant `7adc3d95-5abb-4a82-adbe-2dec5628fa19` → server URL `https://inboxchief.email/api/call-in/vapi/webhook`, phone `+14057169240` assigned.

After step 2, re-run `npm run vapi:setup-call-in` so the `X-Vapi-Secret` header is patched.

Smoke test: call **+1 (405) 716-9240** from a registered patron phone → “read my emails.”

---

## 8. Deploy latest main (only after steps 2 + 4)

```bash
# From Vercel dashboard: Deployments → Redeploy Production
# Or: vercel --prod   (must be logged into eddiebms-projects)
```

Post-deploy checks:

- [ ] `GET https://inboxchief.email/api/health` → `ok: true`, all security flags green
- [ ] Sign up → onboarding → Connect Gmail (test user)
- [ ] Call-in reads Primary mail

---

## 9. Google verification submission (weeks — not today)

Follow **[GOOGLE_OAUTH_PUBLISH.md](./GOOGLE_OAUTH_PUBLISH.md)** Steps 1–8: Search Console domain verify, branding, scope justifications, demo video. Cannot be automated.

---

## Already done (no action)

- Neon: all 15 Prisma migrations applied (including `call_minute_packs`)
- Tests: 394/394 passing on `main`
- Patron-facing code defaults: `https://inboxchief.email`
- VAPI server URL pointed at custom domain (secret header pending step 2)

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

**Short path:** you add their Gmail as test user (step 5) → they sign up or call → connect Gmail → call **+1 (405) 716-9240**.

# Operator runbook — Inbox Chief

**Audience:** Eddie / deploy operators only. Patrons never see this.

Target: **onboard 5 patrons without chaos** (&lt;10 min each).

Live: https://inbox-chief-kappa.vercel.app  
Admin onboard: `/dashboard/admin/onboard`  
Voice provisioning queue: `/dashboard/admin/provisioning`  
Health: `/api/health`

---

## Phase 1 (shipped in product)

| Capability | Where |
| --- | --- |
| Admin onboard (one screen) | `/dashboard/admin/onboard` (OPERATOR_EMAILS) |
| Health + alerts | `/api/health` + operator banner on Settings / Call-in |
| Call-in voice tiers | Settings → Call-in voice; VAPI assistant-request override |
| Standard TTS | Cartesia Sonic (clear, lower cost; cost-guard at 80% minutes) |
| Premium TTS | ElevenLabs Rachel (Pro default) |
| Primary-only call-in | Unchanged |
| Attachment OCR | OCR.space or Google Vision when key set; else clear stub |
| Stripe foundation | Checkout + webhook; live when STRIPE_* set |
| Patron-safe errors | No Google verification / Cloud Console jargon |

---

## Onboard 5 patrons — short path

1. Open **Admin onboard**.
2. Enter **name, Gmail, phone** (E.164).
3. **If OAuth not Published:** click **Copy Gmail** → paste into Google Cloud → Audience → Test users → check **“Gmail enabled for this patron”**.
4. Submit → copy **invite link** + **temporary password** → send to patron.
5. Patron: sign in → Connect Gmail → call **+1 (405) 716-9240** from the saved phone.
6. Stuck login? Re-submit with **“Issue a new temporary password”**.

Repeat for the next four. Do not juggle Cloud Console mid-call with the patron — finish test-user paste first.

## Voice signup → first email-reading call

Google browser consent cannot be skipped. The phone flow automates everything
before it:

1. Patron calls **+1 (405) 716-9240** from their cell.
2. They say **“sign up,” “create account,” or “get started.”**
3. Inbox Chief uses caller ID as their phone, asks for Gmail, spells it back for
   confirmation, and asks for an optional preferred name.
4. The call creates the patron account, personal organization/workspace, enabled
   call-in identity, and a provisioning request.
5. If Twilio SMS env vars are configured, the patron receives a private 24-hour
   link. Otherwise the call speaks an eight-character code to enter at
   `https://inbox-chief-kappa.vercel.app/provision` (the direct result is
   `/provision/CODE`).
6. Until Gmail is connected, calls say the phone is saved and direct the patron
   back to the link/operator. They never read sample mail or attachment contents.
7. After Google consent succeeds, the next call says **“You’re connected. Say
   read my emails.”** Normal calls remain Gmail Primary-only and never send mail.

### Operator steps until OAuth is Published

1. Sign in as an address in `OPERATOR_EMAILS`.
2. Open `https://inbox-chief-kappa.vercel.app/dashboard/admin/provisioning`
   (alias of the queue on Admin onboard).
3. Under **Pending voice signups**, copy the Gmail address.
4. In Google Cloud, open **Google Auth Platform → Audience → Test users**, add
   that exact Gmail, and save.
5. Return to Inbox Chief and check **Mark Gmail enabled** for that patron.
6. Tell the patron to reopen their text link or visit their spoken
   `/provision/CODE` URL, choose the same Gmail in Google, and approve access.
7. Have the patron call **+1 (405) 716-9240** and say **“read my emails.”**

If SMS is unavailable, no account data is emailed. The spoken short code and
public provision URL are the fallback handoff.

## Google OAuth — Publish (Eddie only)

**Prod OAuth project:** `inbox-chief-oauth`
**Prod client ID:** `25385488941-ta679u7okrsndvucqbom0a4rk05nmv95.apps.googleusercontent.com`
**Status (Aug 14, 2026):** Testing mode. `GOOGLE_OAUTH_PUBLISHED=false`. Only test users can connect.

### Done (in code / prod)
- Real, verification-ready **Privacy Policy** (`/privacy`) with the Google API Services **Limited Use disclosure**, scopes, retention/deletion, and contact.
- Real **Terms of Service** (`/terms`).
- Support email + homepage centralized in `src/lib/product.ts` (`supportEmail`, `url`).
- Deployed to prod → https://inbox-chief-kappa.vercel.app/privacy and `/terms`.

### Remaining (browser, Eddie's Google login) — exact clicks
Google Cloud → project **inbox-chief-oauth** → **APIs & Services → OAuth consent screen** (Audience / Branding / Data Access):
1. **Branding:** App name `Inbox Chief`; user support email (Eddie); App homepage `https://inbox-chief-kappa.vercel.app`; Privacy `https://inbox-chief-kappa.vercel.app/privacy`; Terms `https://inbox-chief-kappa.vercel.app/terms`; add authorized domain `vercel.app`; app logo optional.
2. **Data Access → scopes:** confirm `gmail.readonly` + `gmail.send`.
3. **Audience / Publishing status:** **Publish app** → confirm. `gmail.readonly`/`gmail.send` are **restricted scopes**, so Google requires **verification** (possibly a CASA security assessment). Submit the verification form when prompted.
4. **Test users:** keep `courtneycdx@gmail.com` + `eddie@bannermanmenson.com` until verification completes — testers can still connect during review.

### After it's actually usable by non-test users
Only when Publishing status = **In production** and a brand-new Gmail connects without a test-user row, set in Vercel (Production + Preview):
- `GOOGLE_OAUTH_PUBLISHED=true`
- `NEXT_PUBLIC_GOOGLE_OAUTH_PUBLISHED=true`

Then redeploy. Onboard hides the test-user queue/checklist and `/api/health` shows `googleOauthPublished: true`.

> Submitting verification does **not** immediately unblock non-test users. Keep both flags `false` and keep adding test users until Google approves.

## Custom domain (later)

- Point a custom domain at the Vercel project when ready.
- Update Google / Microsoft redirect URIs and `NEXT_PUBLIC_APP_URL` / `CALL_IN_PUBLIC_BASE_URL` to match.

---

## Voice tiers (operators)

| Tier | Provider | Plan |
| --- | --- | --- |
| **Standard** (default Patron) | Cartesia `sonic-english` (clarity-tuned) | Patron only / Pro optional |
| **Premium** (default Pro) | ElevenLabs Rachel | Pro / Business |

**Cost guard:** when monthly minutes ≥80% used, live calls auto-prefer Standard (announce once). Premium uses more of included minutes.

VAPI applies voice **per call** via `assistant-request` override (same phone number, same webhook). See `docs/call-in.md`.

After changing default Standard voice in code, re-run:

```bash
npm run vapi:setup-call-in
```

## Stripe (when going live)

1. Create Products/Prices for Patron ($29 / 90 min) and Pro ($79 / 300 min).
2. Set `STRIPE_SECRET_KEY`, `STRIPE_PRICE_PATRON`, `STRIPE_PRICE_PRO`, `STRIPE_WEBHOOK_SECRET`.
3. Webhook endpoint: `POST /api/billing/webhook` (events: `checkout.session.completed`, `customer.subscription.*`).
4. Check presence via `/api/health` → `checks.stripe`.

## OCR (optional)

- `OCR_SPACE_API_KEY` or `GOOGLE_VISION_API_KEY` enables image / scanned-PDF text for call-in.
- Without a key, attachments announce filename with a clear “can’t read picture text yet” line.

## Env reminders

```
OPERATOR_EMAILS=you@example.com
GOOGLE_OAUTH_PUBLISHED=false
NEXT_PUBLIC_GOOGLE_OAUTH_PUBLISHED=false
VAPI_API_KEY=…
VAPI_ASSISTANT_ID=…
NEXT_PUBLIC_VAPI_CALL_IN_NUMBER=+14057169240
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_SMS_FROM_NUMBER=
OCR_SPACE_API_KEY=
STRIPE_SECRET_KEY=
STRIPE_PRICE_PATRON=
STRIPE_PRICE_PRO=
STRIPE_WEBHOOK_SECRET=
```

## Hard product rules

- Never auto-send
- Primary-only default
- No unlimited calling
- Blind patrons first (Courtney-class a11y)
- Accessibility-first UI

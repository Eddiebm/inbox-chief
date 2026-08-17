# Voice send, optional Calendar, and Contacts

- Gmail voice/web sending uses the existing `gmail.send` grant. A draft must be
  read back or reviewed, then explicitly confirmed in a separate action. There
  is no automatic-send path.
- Add `https://www.googleapis.com/auth/calendar.readonly` to the Google OAuth
  consent-screen scope list for project `gen-lang-client-0169179372` and include
  it in the pending verification submission. Calendar remains a separate,
  optional **Connect Calendar** action in Settings; do not add it to Gmail
  connect.
- The new Calendar scope may show Google's unverified warning until verification
  completes and remains subject to the current 100-user cap.
- Contacts are derived from already-synced mail and require no new Google scope.
  Google People/Contacts API access is intentionally deferred as a possible
  future Pro option.

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

## Google OAuth — ownership + Publish (Eddie only)

**Google account that owns prod OAuth:** `eddie@bannermanmenson.com`
**Prod OAuth project:** `gen-lang-client-0169179372` (Console name: **Default Gemini Project**)
**Prod client ID:** `515908681070-mmpjllceku64t31cdefhfpbt6tpdsvls.apps.googleusercontent.com`
**Status (Aug 14, 2026):** Publishing status **In production**, but Gmail restricted scopes still need Google verification. Keep `GOOGLE_OAUTH_PUBLISHED=false` until a brand-new non-test Gmail can connect cleanly. Test users still work.

**Do not use** the older consumer project `inbox-chief-oauth` (owned by `courtneycdx@gmail.com`). Eddie was added as Owner there, but Workspace access policies still blocked console use. Prod was moved back to Eddie’s project.

### Direct console links (Eddie signed in)
- Audience / test users / Publish: https://console.cloud.google.com/auth/audience?project=gen-lang-client-0169179372
- Branding: https://console.cloud.google.com/auth/branding?project=gen-lang-client-0169179372
- Scopes: https://console.cloud.google.com/auth/scopes?project=gen-lang-client-0169179372
- Clients: https://console.cloud.google.com/auth/clients?project=gen-lang-client-0169179372

### Add a test user (until Published)
1. Open https://console.cloud.google.com/auth/audience?project=gen-lang-client-0169179372
2. Click **Add users**
3. Paste the patron’s exact Gmail → Save
4. In Inbox Chief Admin onboard, check **Gmail enabled for this patron**

### Done (in code / prod)
- Real, verification-ready **Privacy Policy** (`/privacy`) with the Google API Services **Limited Use disclosure**, scopes, retention/deletion, and contact.
- Real **Terms of Service** (`/terms`).
- Support email + homepage centralized in `src/lib/product.ts` (`supportEmail`, `url`).
- Deployed to prod → https://inbox-chief-kappa.vercel.app/privacy and `/terms`.
- Scopes on Eddie’s project: `gmail.readonly` + `gmail.send`.
- Test users present: `eddie@bannermanmenson.com`, `courtneycdx@gmail.com`.
- After OAuth client switch: existing Gmail refresh tokens stop working. App tells patrons to **Connect Gmail** again (no demo mail; call-in says mailbox needs reconnecting).

### Verification steps (Eddie)

Full copy-paste checklist: **[docs/GOOGLE_OAUTH_PUBLISH.md](./GOOGLE_OAUTH_PUBLISH.md)** —
console pages, branding values, drafted scope justifications, demo-video script,
domain verification, and timeline.

Blocker to know up front: verification **cannot** be granted on
`inbox-chief-kappa.vercel.app`. Google requires Search Console ownership of every
authorized domain, and `vercel.app` is a public suffix nobody can own. Buy a
custom domain first (Step 0 of that doc).

### After it's actually usable by non-test users
Only when verification is approved and a brand-new Gmail connects without a test-user row,
set in Vercel (Production + Preview):
- `GOOGLE_OAUTH_PUBLISHED=true`

Then redeploy. That single flag drives everything: onboard hides the test-user
queue/checklist, the patron-facing "unverified app" guidance disappears from
screen and speech, and `/api/health` shows `googleOauthPublished: true`.
`NEXT_PUBLIC_GOOGLE_OAUTH_PUBLISHED` is no longer read and can be deleted.

> Submitting verification does **not** immediately unblock non-test users. Keep the flag
> `false` and keep adding test users until Google approves.

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

## Required security env (production refuses to serve without these)

| Variable | What breaks without it |
| --- | --- |
| `VAPI_WEBHOOK_SECRET` | `POST /api/call-in/vapi/webhook` returns **401 for every request**. Call-in is dead until it is set here *and* as a `X-Vapi-Secret` header on the VAPI assistant's server URL. |
| `AUTH_SECRET` | The server **refuses to boot**. Session cookies and stored mailbox tokens would otherwise use the published `dev-only-change-me` placeholder. |
| `TOKEN_ENCRYPTION_KEY` | Optional — falls back to `AUTH_SECRET`. If you set it *after* mailboxes are connected, existing encrypted Gmail tokens can no longer be decrypted and every patron must reconnect. |
| `TWILIO_AUTH_TOKEN` | `POST /api/call-in/twilio/voice` returns 403. This is the legacy TwiML fallback behind VAPI; leaving it unset simply keeps that path closed. |

Generate real values with `openssl rand -hex 32`. Confirm with `/api/health` →
`checks.vapiWebhookAuthConfigured`, `checks.sessionSecretsConfigured`.

**Order of operations when deploying:** set `VAPI_WEBHOOK_SECRET` in Vercel and
paste the same value into the VAPI assistant's server-URL headers *before or at*
the deploy. The webhook now fails closed, so a deploy without it takes call-in
offline rather than leaving it open.

## Env reminders

```
OPERATOR_EMAILS=you@example.com
GOOGLE_OAUTH_PUBLISHED=false
AUTH_SECRET=…                    # required in production
TOKEN_ENCRYPTION_KEY=            # optional; defaults to AUTH_SECRET
VAPI_API_KEY=…
VAPI_ASSISTANT_ID=…
VAPI_WEBHOOK_SECRET=…            # required in production
NEXT_PUBLIC_VAPI_CALL_IN_NUMBER=+14057169240
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=               # required to enable the TwiML fallback
TWILIO_SMS_FROM_NUMBER=
OCR_SPACE_API_KEY=
STRIPE_SECRET_KEY=
STRIPE_PRICE_PATRON=
STRIPE_PRICE_PRO=
STRIPE_PRICE_MINUTES_30=
STRIPE_PRICE_MINUTES_60=
STRIPE_PRICE_MINUTES_120=
STRIPE_WEBHOOK_SECRET=
```

## Hard product rules

- Never auto-send
- Primary-only default
- No unlimited calling
- Blind patrons first (Courtney-class a11y)
- Accessibility-first UI

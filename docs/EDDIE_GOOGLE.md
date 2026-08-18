# Eddie — Google OAuth verification (paste sheet)

**Agent run:** 2026-08-18. No Google Cloud / Search Console session was available
in the agent browser (login wall). Nothing below was changed in Console from this
run. **Do not set `GOOGLE_OAUTH_PUBLISHED=true` until Google approves.**

**Prod health (live):** `googleOauthPublished: false` · `gmailOauthConfigured: true`

| Fact | Value |
| --- | --- |
| Google account | `eddie@bannermanmenson.com` |
| Cloud project ID | `gen-lang-client-0169179372` |
| OAuth client ID | `515908681070-mmpjllceku64t31cdefhfpbt6tpdsvls.apps.googleusercontent.com` |
| Canonical domain | `https://inboxchief.email` |
| Gmail redirect URI | `https://inboxchief.email/api/gmail/callback` |
| Privacy | `https://inboxchief.email/privacy` |
| Terms | `https://inboxchief.email/terms` |
| Test-user bridge | https://console.cloud.google.com/auth/audience?project=gen-lang-client-0169179372 |

**Pre-flight (verified 2026-08-18):**

- `/privacy` includes **Limited Use disclosure** (live on www after apex→www redirect).
- `/terms` returns 200 (same redirect).
- `/api/health` returns JSON with `googleOauthPublished: false`.
- **DNS:** no Google Search Console TXT record on `inboxchief.email` yet — domain
  verification is still blocked until Eddie adds it.
- **Apex redirect:** `inboxchief.email` still 308→`www.inboxchief.email` (Google
  accepts either if URLs are consistent; apex canonical is the target per
  [EDDIE_TODAY.md](./EDDIE_TODAY.md)).

---

## Eddie clicks in order (10 steps max)

Do these in **one signed-in session** as `eddie@bannermanmenson.com`.

1. **Search Console — verify domain**  
   https://search.google.com/search-console → **Add property** → **Domain** →
   `inboxchief.email` → copy TXT → add at Vercel **Domains → inboxchief.email →
   DNS** (or registrar) → **Verify**.  
   *Blocker today: no TXT record in DNS.*

2. **Branding — authorized domain first**  
   https://console.cloud.google.com/auth/branding?project=gen-lang-client-0169179372  
   Add authorized domain `inboxchief.email`, then paste the table in [Step 2](./GOOGLE_OAUTH_PUBLISH.md#step-2--configure-the-consent-screen-branding) → **Save**.  
   Audience: **External**. Publishing status: **In production**. Language: **English**.

3. **OAuth client — redirect URIs**  
   https://console.cloud.google.com/auth/clients?project=gen-lang-client-0169179372  
   Open client `515908681070-…` → **Authorized redirect URIs** must include:
   ```
   https://inboxchief.email/api/gmail/callback
   https://inbox-chief-kappa.vercel.app/api/gmail/callback
   ```
   **Authorized JavaScript origins:**
   ```
   https://inboxchief.email
   https://www.inboxchief.email
   ```
   → **Save**.

4. **Scopes — declare exactly three**  
   https://console.cloud.google.com/auth/scopes?project=gen-lang-client-0169179372  
   ```
   https://www.googleapis.com/auth/gmail.readonly
   https://www.googleapis.com/auth/gmail.send
   https://www.googleapis.com/auth/calendar.readonly
   ```
   (`calendar.readonly` is optional Connect Calendar in Settings — separate from Gmail connect.)

5. **Wait for Branding status = Published** (Verification Center shows this).  
   Data-access verification cannot start until branding is approved (days–~2 weeks).

6. **Record demo video (~3 min, unlisted YouTube)** — shot list in [Step 7](./GOOGLE_OAUTH_PUBLISH.md#step-7--demo-video).  
   **Eddie must record 3-min demo** (URL bar visible; show client ID, Connect Gmail, consent scopes, call-in read + approved send, disconnect/delete).

7. **Verification Center — paste justifications**  
   https://console.cloud.google.com/auth/verification?project=gen-lang-client-0169179372  
   Copy-paste the three blocks from [Step 5](./GOOGLE_OAUTH_PUBLISH.md#step-5--scope-justification-copy-paste).

8. **Verification Center — paste demo video URL** → **Submit for verification**.

9. **Watch `eddie@bannermanmenson.com`** for Google reviewer email (unanswered questions stall review).

10. **After Google approves + a brand-new non-test Gmail connects cleanly** → set
    `GOOGLE_OAUTH_PUBLISHED=true` in Vercel (Production + Preview) and redeploy.
    **Not before.** See [Step 9](./GOOGLE_OAUTH_PUBLISH.md#step-9--flip-the-flag).

---

## Scope justifications (copy-paste)

Full text lives in [GOOGLE_OAUTH_PUBLISH.md Step 5](./GOOGLE_OAUTH_PUBLISH.md#step-5--scope-justification-copy-paste). Open that section side-by-side with the Verification Center.

---

## Demo video — shot list (Eddie must record)

| # | Duration | Action | Narration (summary) |
| --- | --- | --- | --- |
| 1 | 10s | Cloud Console client page, client ID visible | "OAuth client 515908681070-… in project gen-lang-client-0169179372." |
| 2 | 15s | `https://inboxchief.email` homepage, URL bar visible | Accessibility-first email assistant; never sends without spoken approval. |
| 3 | 30s | Settings → **Connect Gmail**, full OAuth redirect | Patron starts OAuth from production domain. |
| 4 | 30s | Scroll Google consent screen — all scopes legible | User grants readonly + send-after-approval. |
| 5 | 45s | Inbox populated; call **+1 405 716 9240** — "read my emails" | gmail.readonly reads full body aloud. |
| 6 | 45s | On call: draft reply → spoken confirm → sent | gmail.send only after second confirmation. |
| 7 | 30s | Settings → **Disconnect** → **Schedule account deletion** | Revocation and 7-day deletion path. |

Upload **Unlisted** to YouTube → paste link in Verification Center (Step 8 above).

---

## While waiting: test-user bridge (per patron, ~2 min)

1. Patron calls **+1 (405) 716-9240** and completes voice signup (Gmail lands in pending queue), **or** web signup at https://inboxchief.email/signup.
2. **Add test user:** https://console.cloud.google.com/auth/audience?project=gen-lang-client-0169179372 → **Add users** → patron's exact Gmail → **Save**.
3. **Mark enabled:** https://inboxchief.email/dashboard/admin/onboard → **Copy Gmail** → check **Mark Gmail enabled** → submit.
4. Patron uses SMS magic link or spoken short code → **Connect Gmail** → call-in works.

Existing test users (Aug 14 snapshot): `eddie@bannermanmenson.com`, `courtneycdx@gmail.com`.

---

## Honest status

| Question | Answer |
| --- | --- |
| Can a **stranger** Connect Gmail **today**? | **No.** App is In production but restricted scopes are unverified; non-test Gmail hits Google's block. |
| When does that change? | After Google approves verification **and** CASA security assessment (~6 weeks published figure + assessor engagement). Plan **2–3 months** for a brand-new Gmail with no test-user row. |
| Did this agent submit verification? | **No** — login wall + demo video required + Search Console TXT missing. |
| Flip `GOOGLE_OAUTH_PUBLISHED=true` now? | **No** — would lie to patrons and health check. |

---

## What the agent could not do

- Sign in to Google Cloud Console or Search Console (no authenticated browser session).
- Add Search Console TXT (requires Eddie's DNS / Vercel domain panel).
- Upload app logo (needs square PNG ≥120×120 from site branding — export from live site or design asset).
- Submit verification without Eddie's demo video.
- Complete CASA paid security assessment or shorten Google's review queue.

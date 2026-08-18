# Eddie — Google OAuth verification (paste sheet)

**Agent run:** 2026-08-18. No Google Cloud / Search Console session was available
in the agent browser (login wall). Nothing below was changed in Console from this
run. **Do not set `GOOGLE_OAUTH_PUBLISHED=true` until Google approves.**

**Prod health (live):** `googleOauthPublished: false` · `gmailOauthConfigured: true`
*(still on legacy YT Studio client until Eddie creates the dedicated project and updates Vercel)*

## Separate from YT Studio

| Project | Purpose | Action |
| --- | --- | --- |
| `gen-lang-client-0169179372` (*Default Gemini Project*, branded **YT Studio**) | YT Studio only | **Do not modify** |
| Courtney's legacy `inbox-chief-oauth` | Abandoned (Workspace blocked) | **Do not reuse** |
| **New:** `YOUR_PROJECT_ID` (e.g. `inbox-chief-oauth` or `inbox-chief-prod`) | **Inbox Chief production OAuth** | **Create under `eddie@bannermanmenson.com`** |

| Fact | Value |
| --- | --- |
| Google account | `eddie@bannermanmenson.com` |
| Cloud project ID | `YOUR_PROJECT_ID` *(after Step 0)* |
| OAuth client ID | *(after Step 0 — set `GOOGLE_CLIENT_ID` in Vercel)* |
| Canonical domain | `https://inboxchief.email` |
| Gmail redirect URI | `https://inboxchief.email/api/gmail/callback` |
| Privacy | `https://inboxchief.email/privacy` |
| Terms | `https://inboxchief.email/terms` |
| Test-user bridge | https://console.cloud.google.com/auth/audience?project=YOUR_PROJECT_ID |

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

0. **Create dedicated GCP project** — full steps in [GOOGLE_OAUTH_PUBLISH.md Step 0](./GOOGLE_OAUTH_PUBLISH.md#step-0--create-the-inbox-chief-gcp-project-do-this-first):  
   project **Inbox Chief**, enable Gmail + Calendar APIs, consent screen, OAuth Web client, copy credentials to Vercel (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CLOUD_PROJECT_ID`, `NEXT_PUBLIC_GOOGLE_CLOUD_PROJECT_ID`), redeploy.

1. **Search Console — verify domain**  
   https://search.google.com/search-console → **Add property** → **Domain** →
   `inboxchief.email` → copy TXT → add at Vercel **Domains → inboxchief.email →
   DNS** (or registrar) → **Verify**.  
   *Blocker today: no TXT record in DNS.*

2. **Branding — authorized domain first**  
   https://console.cloud.google.com/auth/branding?project=YOUR_PROJECT_ID  
   Add authorized domain `inboxchief.email`, then paste the table in [Step 3](./GOOGLE_OAUTH_PUBLISH.md#step-3--configure-the-consent-screen-branding) → **Save**.  
   Audience: **External**. Publishing status: **In production**. Language: **English**.

3. **OAuth client — redirect URIs**  
   https://console.cloud.google.com/auth/clients?project=YOUR_PROJECT_ID  
   Open your **Inbox Chief production** client → **Authorized redirect URIs** must include:
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
   https://console.cloud.google.com/auth/scopes?project=YOUR_PROJECT_ID  
   ```
   https://www.googleapis.com/auth/gmail.readonly
   https://www.googleapis.com/auth/gmail.send
   https://www.googleapis.com/auth/calendar.readonly
   ```
   (`calendar.readonly` is optional Connect Calendar in Settings — separate from Gmail connect.)

5. **Wait for Branding status = Published** (Verification Center shows this).  
   Data-access verification cannot start until branding is approved (days–~2 weeks).

6. **Record demo video (~3 min, unlisted YouTube)** — shot list in [Step 8](./GOOGLE_OAUTH_PUBLISH.md#step-8--demo-video).  
   **Eddie must record 3-min demo** (URL bar visible; show client ID, Connect Gmail, consent scopes, call-in read + approved send, disconnect/delete).

7. **Verification Center — paste justifications**  
   https://console.cloud.google.com/auth/verification?project=YOUR_PROJECT_ID  
   Copy-paste the three blocks from [Step 6](./GOOGLE_OAUTH_PUBLISH.md#step-6--scope-justification-copy-paste).

8. **Verification Center — paste demo video URL** → **Submit for verification**.

9. **Watch `eddie@bannermanmenson.com`** for Google reviewer email (unanswered questions stall review).

10. **After Google approves + a brand-new non-test Gmail connects cleanly** → set
    `GOOGLE_OAUTH_PUBLISHED=true` in Vercel (Production + Preview) and redeploy.
    **Not before.** See [Step 10](./GOOGLE_OAUTH_PUBLISH.md#step-10--flip-the-flag).

---

## Scope justifications (copy-paste)

Full text lives in [GOOGLE_OAUTH_PUBLISH.md Step 6](./GOOGLE_OAUTH_PUBLISH.md#step-6--scope-justification-copy-paste). Open that section side-by-side with the Verification Center.

---

## Demo video — shot list (Eddie must record)

| # | Duration | Action | Narration (summary) |
| --- | --- | --- | --- |
| 1 | 10s | Cloud Console client page, client ID visible | "OAuth client [YOUR_CLIENT_ID] in project [YOUR_PROJECT_ID]." |
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
2. **Add test user:** https://console.cloud.google.com/auth/audience?project=YOUR_PROJECT_ID → **Add users** → patron's exact Gmail → **Save**.
3. **Mark enabled:** https://inboxchief.email/dashboard/admin/onboard → **Copy Gmail** → check **Mark Gmail enabled** → submit.
4. Patron uses SMS magic link or spoken short code → **Connect Gmail** → call-in works.

After switching to the new OAuth project, re-add test users on the **new** project's Audience page.

---

## Honest status

| Question | Answer |
| --- | --- |
| Can a **stranger** Connect Gmail **today**? | **No.** App is In production but restricted scopes are unverified; non-test Gmail hits Google's block. |
| When does that change? | After Google approves verification **and** CASA security assessment (~6 weeks published figure + assessor engagement). Plan **2–3 months** for a brand-new Gmail with no test-user row. |
| Did this agent submit verification? | **No** — login wall + demo video required + Search Console TXT missing. |
| Did this agent create the new GCP project? | **No** — login wall. Follow Step 0 in [GOOGLE_OAUTH_PUBLISH.md](./GOOGLE_OAUTH_PUBLISH.md). |
| Flip `GOOGLE_OAUTH_PUBLISHED=true` now? | **No** — would lie to patrons and health check. |

---

## What the agent could not do

- Sign in to Google Cloud Console or Search Console (no authenticated browser session).
- Create the dedicated Inbox Chief GCP project or OAuth client.
- Add Search Console TXT (requires Eddie's DNS / Vercel domain panel).
- Upload app logo (needs square PNG ≥120×120 from site branding — export from live site or design asset).
- Submit verification without Eddie's demo video.
- Complete CASA paid security assessment or shorten Google's review queue.

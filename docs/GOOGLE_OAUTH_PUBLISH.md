# Google OAuth restricted-scope verification — do-this-now checklist (Eddie only)

Everything in this file requires a human in the Google Cloud Console and cannot be
done from code. When it is finished, flipping **one** environment variable
(`GOOGLE_OAUTH_PUBLISHED=true`) removes every "unverified app" instruction from
the patron-facing app automatically. See [Step 10](#step-10--flip-the-flag).

**Quick paste sheet (10 clicks, status, test-user bridge):** [EDDIE_GOOGLE.md](./EDDIE_GOOGLE.md)

**Agent status (2026-08-18):** No Console changes from automation — login required.
Live `/api/health` still reports `googleOauthPublished: false`. Search Console TXT
for `inboxchief.email` not yet in DNS. Demo video not recorded → verification not
submitted. Do **not** flip `GOOGLE_OAUTH_PUBLISHED=true` until Google approves.

## Dedicated Inbox Chief project (required)

Inbox Chief must use its **own** Google Cloud OAuth project — separate from **YT Studio**
(`gen-lang-client-0169179372`, Console name *Default Gemini Project*). **Do not modify
that project**; it stays on YT Studio branding and credentials.

Also **do not reuse** Courtney's legacy consumer project `inbox-chief-oauth`
(`courtneycdx@gmail.com`) — Workspace policies blocked console access there.

**Primary path:** create a fresh project under `eddie@bannermanmenson.com` (suggested
Project ID `inbox-chief-oauth` or `inbox-chief-prod` if the ID is taken globally).
Until the project exists, substitute `YOUR_PROJECT_ID` in every Console URL below.

**Project facts you will need to paste (fill after Step 0):**

| Field | Value |
| --- | --- |
| Google account that owns prod OAuth | `eddie@bannermanmenson.com` |
| Cloud project ID | `YOUR_PROJECT_ID` *(set `GOOGLE_CLOUD_PROJECT_ID` in Vercel after creation)* |
| Prod OAuth client ID | *(from Step 0 → OAuth client — set `GOOGLE_CLIENT_ID` in Vercel)* |
| Support / contact email | `eddie@bannermanmenson.com` |
| Restricted scope | `https://www.googleapis.com/auth/gmail.readonly` |
| Sensitive scope | `https://www.googleapis.com/auth/gmail.send` |
| Sensitive scope (optional feature) | `https://www.googleapis.com/auth/calendar.readonly` |

---

## Step 0 — Create the Inbox Chief GCP project (do this first)

Sign in as `eddie@bannermanmenson.com`.

1. Open https://console.cloud.google.com/projectcreate
2. **Project name:** `Inbox Chief`
3. **Project ID:** prefer `inbox-chief-oauth`; if taken, use `inbox-chief-prod` or accept Google's suffix
4. **Create** → select the new project in the top bar
5. **Enable APIs** → https://console.cloud.google.com/apis/library  
   Enable **Gmail API** and **Google Calendar API** (Calendar is optional Connect Calendar in Settings)
6. **OAuth consent screen** → https://console.cloud.google.com/auth/branding?project=YOUR_PROJECT_ID  
   Follow [Step 2](#step-2--configure-the-consent-screen-branding) (App name **Inbox Chief**, domain `inboxchief.email`)
7. **OAuth client** → https://console.cloud.google.com/auth/clients?project=YOUR_PROJECT_ID  
   **Create client** → **Web application** → name `Inbox Chief production`  
   Authorized redirect URIs and JavaScript origins: see [Step 3](#step-3--confirm-the-oauth-client-redirect-uris)
8. Copy **Client ID** and **Client secret** → set in Vercel (Production **and** Preview):
   ```
   GOOGLE_CLIENT_ID=<client-id>.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=<from Console — do not commit>
   GOOGLE_CLOUD_PROJECT_ID=<your-project-id>
   NEXT_PUBLIC_GOOGLE_CLOUD_PROJECT_ID=<same project id>
   GOOGLE_REDIRECT_URI=https://inboxchief.email/api/gmail/callback
   ```
9. **Redeploy** after env vars are set. Existing patron Gmail tokens from the old
   YT Studio client will stop working — patrons must **Connect Gmail** again.

Replace `YOUR_PROJECT_ID` in all links below with your actual project ID.

---
## Step 1 — Custom domain cutover (`inboxchief.email`)

**You cannot get verified on `inbox-chief-kappa.vercel.app`.** Google requires
you to prove ownership of every authorized domain in Google Search Console, and
it asks for the "top private domain". `vercel.app` is on the public suffix list,
so it is not a domain you can own or verify.

**Domain:** `inboxchief.email` (target canonical apex; `www` should redirect to apex).

Cutover status (2026-08-17): domain is attached, HTTPS works, `/api/health` returns
JSON on both hosts. **Eddie still must flip redirect** if apex currently 308→www
(see [EDDIE_TODAY.md](./EDDIE_TODAY.md) step 1).

Before submitting verification:

1. In the Vercel account that owns project `inbox-chief` → **Settings → Domains**,
   confirm `inboxchief.email` and `www.inboxchief.email` show **Valid Configuration**.
   Set **Redirect** so `www` → `inboxchief.email` (apex canonical).
2. Confirm `https://inboxchief.email/api/health` returns JSON on apex (not only www).
3. Set these Vercel environment variables (Production **and** Preview):
   - `NEXT_PUBLIC_APP_URL=https://inboxchief.email`
   - `CALL_IN_PUBLIC_BASE_URL=https://inboxchief.email`
   - `GOOGLE_REDIRECT_URI=https://inboxchief.email/api/gmail/callback`
   - Also update `MICROSOFT_REDIRECT_URI` if Outlook connect is live:
     `https://inboxchief.email/api/outlook/callback`
4. In the Google client config, add the new redirect URI (see Step 4). Keep the
   old `inbox-chief-kappa.vercel.app` redirect until cutover is verified.
5. Update Stripe webhook URL to `https://inboxchief.email/api/billing/webhook`
   (only once HTTPS is Valid; Stripe is not live yet).
6. Update VAPI assistant **Server URL** to
   `https://inboxchief.email/api/call-in/vapi/webhook`, then re-run
   `npm run vapi:setup-call-in` so spoken prompts use the new host.

**VAPI_WEBHOOK_SECRET:** do not invent or rotate this without Eddie confirming the
value. If fail-closed webhook auth is about to deploy and the secret is not yet
in both Vercel and the VAPI assistant `X-Vapi-Secret` header, set the secret in
both places **before** that deploy — otherwise call-in goes offline (401).

---

## Step 2 — Verify domain ownership in Search Console

1. Open https://search.google.com/search-console — sign in as `eddie@bannermanmenson.com`
   (must be the same account that is Owner/Editor on the Cloud project).
2. **Add property** → choose **Domain** → enter `inboxchief.email`.
3. Copy the TXT record Google shows, add it in your registrar's DNS, then click **Verify**.
4. Wait until the property shows as verified. Verification failures here are the
   single most common cause of a rejected OAuth submission.

---

## Step 3 — Configure the consent screen (Branding)

Open https://console.cloud.google.com/auth/branding?project=YOUR_PROJECT_ID

Enter exactly:

| Field | Paste this |
| --- | --- |
| App name | `Inbox Chief` |
| User support email | `eddie@bannermanmenson.com` |
| App logo | Square PNG, 120×120 or larger, no transparency, matches the site branding |
| Application home page | `https://inboxchief.email` |
| Application privacy policy link | `https://inboxchief.email/privacy` |
| Application terms of service link | `https://inboxchief.email/terms` |
| Authorized domain | `inboxchief.email` |
| Developer contact email | `eddie@bannermanmenson.com` |

Notes:

- Add the **authorized domain before** the homepage/privacy/terms URLs, or the console rejects them.
- The consent screen language toggle (bottom-left) must be **English**.
- Audience must be **External**, publishing status **In production**.
- Changing the app name, logo, or any of these URLs later forces a fresh brand review.

---

## Step 4 — Confirm the OAuth client redirect URIs

Open https://console.cloud.google.com/auth/clients?project=YOUR_PROJECT_ID
→ open your **Inbox Chief production** Web client

Authorized redirect URIs must contain (keep the Vercel one until the domain cutover is done):

```
https://inboxchief.email/api/gmail/callback
https://inbox-chief-kappa.vercel.app/api/gmail/callback
```

Authorized JavaScript origins (include both while apex/www redirect is settling):

```
https://inboxchief.email
https://www.inboxchief.email
```

---

## Step 5 — Declare exactly these scopes

Open https://console.cloud.google.com/auth/scopes?project=YOUR_PROJECT_ID

Add only:

```
https://www.googleapis.com/auth/gmail.readonly
https://www.googleapis.com/auth/gmail.send
https://www.googleapis.com/auth/calendar.readonly
```

Do not add `https://mail.google.com/`, `gmail.modify`, or any drive/contacts
scope. Requesting anything broader than the above will get the submission
bounced for violating minimum-scope policy.

---

## Step 6 — Scope justification (copy-paste)

Paste each block into the matching justification box in the Verification Center.

### `gmail.readonly` (restricted)

```
Inbox Chief is an accessibility-first email assistant for blind and low-vision
users. Patrons cannot read a screen, so they call a phone number and the
assistant reads their email aloud over the phone.

gmail.readonly is required to fetch the content the user asks to hear. When a
patron says "read my emails", we call users.messages.list and users.messages.get
to retrieve the sender, subject, received time, and the full message body, then
read that text aloud via text-to-speech. If the message has an attachment, we
call users.messages.attachments.get only when the patron explicitly asks for that
specific attachment, so we can convert it to speech.

A narrower scope does not work for this product. gmail.metadata returns only
headers and labels, which cannot be read aloud as the content of the email, and
that content is the entire function of the product. We request read-only access
rather than gmail.modify because we never alter, label, or delete the user's
mail.

Data handling: message content is used solely to answer the signed-in patron's
own spoken request. We store message metadata and body text only to serve the
patron's own account, encrypted at rest, scoped per tenant. We do not use Gmail
data for advertising, we do not sell it, and we do not use it to train
generalized AI models. Patrons can disconnect the mailbox or delete their
account at any time from Settings, which revokes our token and removes their
data.
```

### `gmail.send` (sensitive)

```
gmail.send is used only to deliver a reply that the patron has already approved.

The flow is deliberately two-stage and never automatic. The assistant drafts a
reply, reads the full draft back to the patron over the phone, and the patron
must give an explicit spoken confirmation in a separate second step before the
message is delivered. Nothing is sent without that human approval; the product
enforces this in code and rejects any tool call that would send mail without a
confirmed approval.

We request gmail.send rather than a broader scope because we only ever need to
deliver a new outbound message. We do not need to read, modify, label, or delete
mail with this scope.
```

### `calendar.readonly` (sensitive, optional feature)

```
Calendar is an optional feature the patron connects separately. When a patron
asks "what's on my calendar today", we call events.list and read the event
start time, title, and location aloud. We request read-only access because the
assistant never creates, edits, or deletes events.
```

---

## Step 7 — Limited Use disclosure (already live)

Google will check that your privacy policy contains the Limited Use language.
This is **already implemented** and deployed at `/privacy` under the heading
**"Limited Use disclosure"** (source: `src/app/privacy/page.tsx`). It states that
Inbox Chief's use and transfer of Google API data adheres to the Google API
Services User Data Policy including the Limited Use requirements, that data is
not used for advertising or sold, and that humans do not read the data except
with consent, for security, or when aggregated/anonymized.

Action needed: nothing, except confirm the page loads on the new custom domain
at `https://inboxchief.email/privacy` before submitting.

---

## Step 8 — Demo video

Requirements: unlisted YouTube video, one link only, English, recorded against
the **production** domain, and the browser URL bar must be visible so the
reviewer can read the OAuth client ID during consent.

### Shot list and narration script

**1. Show the client ID (10s).** Screen-record the Cloud Console client page with
the client ID visible.

> "This is the Inbox Chief OAuth client, ID [YOUR_CLIENT_ID], in project [YOUR_PROJECT_ID]."

**2. Show the homepage (15s).** Load `https://inboxchief.email` with the URL bar visible.

> "Inbox Chief is an accessibility-first email assistant for blind and low-vision users. It reads email aloud over the phone and never sends anything without spoken approval."

**3. Start the OAuth flow (30s).** Sign in, go to Settings, click **Connect Gmail**.
Keep the URL bar visible through the whole redirect.

> "The patron taps Connect Gmail. This starts the Google OAuth flow from our production domain."

**4. The consent screen (30s).** Slowly scroll the Google consent screen so every
requested scope is legible.

> "Google asks the user to approve read access to Gmail and permission to send mail only after approval. The user grants consent here. Nothing happens before this approval."

**5. gmail.readonly in use (45s).** Back in the app, show the inbox populated. Then
place a real call to +1 405 716 9240 from the registered phone and say
"read my emails" — capture the audio of the assistant reading a real message aloud.

> "This is gmail.readonly in use. The assistant retrieves the sender, subject, and full body of the patron's own message and reads it aloud, because the patron cannot see the screen."

**6. gmail.send in use (45s).** On the call, ask the assistant to reply. Let it read
the draft back, then give the spoken confirmation, and show the sent message.

> "For sending, the assistant reads the draft back and waits for an explicit spoken confirmation. Only after this second confirmation does Inbox Chief use gmail.send to deliver the message. This is the only path that sends mail."

**7. Revocation and deletion (30s).** In Settings, show **Disconnect**, then the
one-button **Schedule account deletion** with its cooling-off notice.

> "The patron can disconnect the mailbox at any time, which revokes our Google token, or delete the account entirely with a seven-day cooling-off period that removes their data."

Upload as **Unlisted**, then paste the link into the Verification Center.

---

## Step 9 — Submit, then the security assessment

1. Open the Verification Center:
   https://console.cloud.google.com/auth/verification?project=YOUR_PROJECT_ID
2. Confirm **Branding status** is published first — data-access verification cannot
   be requested until branding is approved.
3. Fill in the scope justifications (Step 6) and the demo video link (Step 8).
4. Click **Submit for verification**.
5. Watch the inbox of `eddie@bannermanmenson.com` — all reviewer correspondence
   goes to project owners/editors by email, and unanswered questions stall the review.
6. **CASA security assessment.** Because Inbox Chief requests a restricted scope
   *and* stores Google user data on a server (encrypted refresh tokens and message
   text in Postgres), a security assessment by a Google-empanelled third-party
   assessor is required. The review team emails you when it is time to begin.
   It is a paid, annual engagement — budget money and calendar time for it.

### Expected timeline

| Stage | Realistic duration |
| --- | --- |
| Domain purchase + Search Console verification | Same day |
| Brand verification | Days to ~2 weeks |
| Restricted-scope review | ~6 weeks (Google's own published figure) |
| CASA security assessment | Several weeks, runs in parallel/after; repeats annually |

Plan on **two to three months** before a brand-new Gmail can connect without
being a test user. Keep onboarding patrons via the test-user path meanwhile.

---

## Step 10 — Flip the flag

Only when publishing status is **In production**, verification is approved, **and**
a brand-new Gmail that is *not* in the test-user list connects cleanly:

Set in Vercel (Production + Preview):

```
GOOGLE_OAUTH_PUBLISHED=true
```

Then redeploy. That single flag is now the only switch. `NEXT_PUBLIC_GOOGLE_OAUTH_PUBLISHED`
is no longer read by anything and can be deleted.

Flipping it automatically:

- Removes the "Google will show an unverified app notice — choose Advanced, then Continue"
  guidance from the setup page, Settings, and the spoken phone prompts.
- Stops creating test-user gates for new voice signups, so `provision_signup` hands
  patrons straight to Google consent.
- Hides the operator test-user queue and checklist.
- Reports `googleOauthPublished: true` at `/api/health`.

Verify after deploy:

```bash
curl -s https://inboxchief.email/api/health | grep googleOauthPublished
```

---

## While you wait: adding a test user (2 minutes per patron)

Google's 100-test-user cap applies, which is far above the near-term target.

1. Patron calls +1 405 716 9240 and completes voice signup. Their Gmail lands in
   the pending queue automatically — no data entry by you.
2. Open https://console.cloud.google.com/auth/audience?project=YOUR_PROJECT_ID
3. **Add users** → paste the Gmail → **Save**.
4. Open https://inboxchief.email/dashboard/admin/onboard → in
   **Pending voice signups**, use **Copy Gmail** to get the exact address, then
   check **Mark Gmail enabled**.
5. The patron's SMS magic link (or spoken short code) now goes straight to Google
   consent. Nothing else to send them.

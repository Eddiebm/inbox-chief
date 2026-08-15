# Setup friction: operator vs patron

Inbox Chief must never make blind patrons walk through Google Cloud, VAPI
dashboards, or env-var debugging. That pain is **operator-only**.

## Operator-only (Eddie / deploy)

These stay off patron screens:

| Task | Why patrons never see it |
| --- | --- |
| Google Cloud OAuth client + redirect URIs | App credentials; one shared client for the product |
| Google OAuth **Test users** (while app is in Testing / unpublished) | Until Google verifies & publishes the app, every new patron Gmail must be added under Audience → Test users or Connect will fail with `access_denied` |
| Azure / Microsoft OAuth (if used) | Same — operator configures once |
| `GOOGLE_CLIENT_*`, `MOCK_INTEGRATIONS` | Env on Vercel / host |
| VAPI API key + assistant ↔ phone number link | `VAPI_ASSISTANT_ID`, number assignment |
| Neon / `DATABASE_URL` | Persistence for real accounts |
| Operator checklist in Settings | Shown only when `OPERATOR_EMAILS` matches the signed-in user |
| Admin onboard | `/dashboard/admin/onboard` — create patron + CallInIdentity + checklist |

## Patron path (simple)

Maximum **three** onboarding steps:

1. **Welcome / consent** — one heading, one sentence, Continue  
2. **Connect Gmail** — one Google consent; skip if already connected  
3. **Save call-in phone** — optional; skip if already saved  

Then → dashboard. After that they may optionally dial the shared number.

Patron errors are one short spoken + visible sentence (no Cloud Console, no
env names, no “set assistant ID”).

## What patrons see instead of raw errors

| Situation | Patron message |
| --- | --- |
| Gmail OAuth env missing | “Inbox Chief isn’t ready to connect Gmail yet. Please contact support.” |
| Google `access_denied` / not approved | “Your Google account isn’t enabled for Inbox Chief yet. Contact support and we’ll turn it on — then try Connect Gmail again.” |
| VAPI number set but assistant not linked | “Phone assistant is being set up. You can still use Ask by voice on this page.” |
| Demo / mock session in Settings | “Demo session — connect a real account” — never `demo_org` / `mock@example.com` as “your” data |

## Call-in phone field

Empty value + placeholder text only (“Your phone number with country code”).
Never prefill `+15551234567`.

**Unrecognized inbound calls:** speak phone-only instructions (Settings → Anytime
call-in phone → save the exact number calling from → call again). Never invent
person names from CNAM / caller ID, and never play demo mail when
`MOCK_INTEGRATIONS=false` — blind patrons rely on exact speech.

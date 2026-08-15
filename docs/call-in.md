# Anytime phone call-in (VAPI primary, Twilio fallback)

Inbox Chief’s phone path prefers **VAPI**. Twilio remains available as a fallback webhook.

## Production dial-in number

**+1 (405) 716-9240** (`+14057169240`)

Shown in the app when `NEXT_PUBLIC_VAPI_CALL_IN_NUMBER` is set.

## Webhooks

| Provider | URL |
| -------- | --- |
| **VAPI (primary)** | `POST https://inbox-chief-kappa.vercel.app/api/call-in/vapi/webhook` |
| Twilio (fallback) | `POST https://inbox-chief-kappa.vercel.app/api/call-in/twilio/voice` |

The VAPI webhook handles `assistant-request`, `tool-calls`, and `end-of-call-report`. Tools answer briefing / read emails / needs attention / drafts / approvals / follow-ups / connection status via `src/lib/call-in/assistant.ts`.

### Voice tiers (Standard / Premium)

| Tier | Provider | Default plan |
| --- | --- | --- |
| **Standard** | Cartesia Sonic (`sonic-english`) — clear, lower TTS cost | Patron |
| **Premium** | ElevenLabs Rachel — richer sound | Pro / Business |

Preference is stored on `AccessibilityPreference.callInVoiceTier`. Settings → **Call-in voice** (also on `/dashboard/call-in`). Patron selecting Premium hears “Included on Pro” and stays on Standard. Pro may choose Standard to save cost.

**VAPI approach:** one shared phone number + webhook. On each `assistant-request`, Inbox Chief returns a full assistant override with the caller’s effective `voice` (no second assistant ID required). Setup script seeds the **Standard** voice as the dashboard default; live calls override per patron.

Optional first-call tip (once): “Using standard voice to keep costs down. Premium is on Pro.”

Premium uses more of included minutes’ **dollar value**; overage $/min is unchanged.

On `end-of-call-report`, Inbox Chief stores **call cost in USD** (VAPI `cost` / `call.cost`, plus duration and `endedReason`) on `CallSession`, scoped to the matched `CallInIdentity` tenant. If the webhook omits cost, it falls back to `GET https://api.vapi.ai/call/:id` using `VAPI_API_KEY`. Running tallies appear under **Call costs** on `/dashboard/call-in` and Settings (`GET /api/call-in/costs`). Org minute usage for the billing period is at `GET /api/billing/usage` (included / used / overage). Soft cap: warn at 80% and at the included limit; calls continue and overage is metered — never cut off mid-email without warning.

**Accessibility (blind patrons):** briefing and “read my emails” speak messages **one at a time** — From, Subject, then body or snippet — then pause for next / more detail / draft in the app. **Nothing sends email from a call.**

Tool results include per-email readable text (prefer `bodyText`, else Gmail/Outlook `snippet`). If only metadata exists, the assistant says so and still reads subject/from.

## Env

```bash
# Required to create/update the assistant
VAPI_API_KEY=

# Optional once created by scripts/vapi-setup-call-in.ts
VAPI_ASSISTANT_ID=

# Phone number id from VAPI dashboard (optional; used by setup script to assign inbound)
VAPI_PHONE_NUMBER_ID=

# Displayed in Call-in UI / Settings
NEXT_PUBLIC_VAPI_CALL_IN_NUMBER=+14057169240

# Optional shared secret (sent as x-vapi-secret)
VAPI_WEBHOOK_SECRET=
```

## Setup assistant

```bash
VAPI_API_KEY=... npx tsx scripts/vapi-setup-call-in.ts
# or: npm run vapi:setup-call-in
```

The script creates/updates the assistant (server URL = webhook below), looks up **+14057169240**, PATCHes `assistantId`, then GETs the phone number to verify the link.

### Dashboard fallback (no API key)

If automation cannot auth to VAPI:

1. Open [dashboard.vapi.ai](https://dashboard.vapi.ai) and sign in (Google / GitHub / email).
2. Left nav → **Assistants** → **Create Assistant** (or open an existing Inbox Chief assistant).
3. Set **name** to `Inbox Chief — Anytime Call-in`.
4. Set **Server URL** to:
   `https://inbox-chief-kappa.vercel.app/api/call-in/vapi/webhook`
5. Save / publish the assistant (copy the assistant id if shown).
6. Left nav → **Phone Numbers**.
7. Click **+1 (405) 716-9240** (`+14057169240`).
8. Find **Inbound Assistant** / **Assistant** → select `Inbox Chief — Anytime Call-in`.
9. **Save**.
10. Re-test: call **+1 (405) 716-9240** from the phone registered in Inbox Chief Settings.

## Caller identity

Register the **exact phone you dial from** under **Settings → Anytime call-in phone** (E.164, e.g. `+14055551234`). That is your cell / landline caller ID — **not** the Inbox Chief dial-in line (`+14057169240`).

Inbound VAPI `customer.number` maps to `CallInIdentity` → your mailbox. If the number is not registered (or caller ID is missing), the assistant says clearly:

> I don't recognize this phone number. Open Settings, find Anytime call-in phone, save the exact number you are calling from, then call again.

**Hard rule (accessibility):** Unrecognized phone must never invent names (CNAM / caller ID name / LLM guess) or demo mail — blind patrons rely on exact speech. Only `customer.number` is used for identity; `customer.name` is ignored for speech. Use our app’s known display name only **after** a successful match.

It does **not** invent demo emails when `MOCK_INTEGRATIONS=false`. Demo fixtures are only used when `MOCK_INTEGRATIONS=true` (local/dev).

After saving, call **+1 (405) 716-9240** from that registered phone and say “read my emails” or “briefing”.

### Retest checklist

1. Sign in as the mailbox owner.
2. Settings → Anytime call-in phone → save your cell in E.164 (`+1…`, e.g. `+14055106989`).
3. Confirm save returns `persisted: true` (Network tab) — not localStorage-only. Settings should show the DB-saved number on reload.
4. Dial **+14057169240** from that same cell.
5. Ask to read emails — subjects should match real Gmail (e.g. not “Schedule confirmation for Thursday”).
6. If you hear the unrecognized-phone line, the caller ID does not match the saved E.164 (check formatting / blocked caller ID). Never expect a person name in that line.

## Twilio fallback

Keep `TWILIO_*` configured if you still want the TwiML gather path. Product UX should advertise the VAPI number first.

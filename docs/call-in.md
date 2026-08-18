# Anytime phone call-in (VAPI primary, Twilio fallback)

Inbox Chief’s phone path prefers **VAPI**. Twilio remains available as a fallback webhook.

## Outbound calls for new Primary mail

Pro and Business subscribers can opt in under **Settings → Email call alerts**
or **Call in → Email call alerts**. Patron sees the disabled control with an
upgrade link. The preference is off by default and requires a saved
`CallInIdentity` phone plus a connected Gmail mailbox. Both the settings API and
sync trigger enforce the plan gate.

After Gmail sync inserts new messages, Inbox Chief counts only Primary mail and
creates an outbound call with `POST https://api.vapi.ai/call`, the configured
VAPI phone-number ID, assistant ID, and `customer.number` set to the subscriber's
saved E.164 phone. Calls are batched with a durable 15-minute cooldown. They are
skipped when there is no new Primary mail, the preference is off, the mailbox is
disconnected, the phone is missing, or included call minutes are exhausted.
Promotions, social, updates, forums, spam, and previously stored messages do not
trigger the call.

Opening example: “You have 2 new emails in Primary. The newest is from Jordan
Lee about Schedule confirmation. Say read the new ones.” Only the newest
Primary sender and subject are announced before consent to read; the existing
call-in tools provide the real tenant-scoped mail and the call never sends email.

Vercel invokes `GET /api/cron/gmail-sync` daily at 15:00 UTC on the current
Hobby plan (Vercel only permits daily cron there). On Pro, change the schedule
to `*/5 * * * *` for five-minute polling. The route requires
`Authorization: Bearer $CRON_SECRET`, selects only opted-in identities, and
re-validates organization, workspace, mailbox, owner, and connected status
before each sync. Configure `CRON_SECRET` in production; Vercel adds this header
automatically for cron invocations.

## Production dial-in number

**+1 (405) 716-9240** (`+14057169240`)

Shown in the app when `NEXT_PUBLIC_VAPI_CALL_IN_NUMBER` is set.

## Webhooks

| Provider | URL |
| -------- | --- |
| **VAPI (primary)** | `POST https://inboxchief.email/api/call-in/vapi/webhook` |
| Twilio (fallback) | `POST https://inboxchief.email/api/call-in/twilio/voice` |

The VAPI webhook handles `assistant-request`, `tool-calls`, and `end-of-call-report`. Tools answer briefing / read emails / needs attention / drafts / approvals / follow-ups / connection status via `src/lib/call-in/assistant.ts`.

### Voice tiers (Standard / Premium)

| Tier | Provider | Default plan |
| --- | --- | --- |
| **Standard** | Cartesia Sonic (`sonic-english`) — clear, lower TTS cost | Patron |
| **Premium** | ElevenLabs Rachel — richer sound | Pro / Business |

Preference is stored on `AccessibilityPreference.callInVoiceTier`. Settings → **Call-in voice** (also on `/dashboard/call-in`). Patron selecting Premium hears “Included on Pro” and stays on Standard. Pro may choose Standard to save cost.

**VAPI approach:** one shared phone number + webhook. On each `assistant-request`, Inbox Chief returns a full assistant override with the caller’s effective `voice` (no second assistant ID required). Setup script seeds the **Standard** voice as the dashboard default; live calls override per patron.

Optional first-call tip (once): “Using standard voice to keep costs down. Premium is on Pro.”

Premium uses more of included minutes’ **dollar value**. Extra use is prepaid minute packs (rollover), not silent overage.

On `end-of-call-report`, Inbox Chief stores **call cost in USD** (VAPI `cost` / `call.cost`, plus duration and `endedReason`) on `CallSession`, scoped to the matched `CallInIdentity` tenant. If the webhook omits cost, it falls back to `GET https://api.vapi.ai/call/:id` using `VAPI_API_KEY`. Running tallies appear under **Call costs** on `/dashboard/call-in` and Settings (`GET /api/call-in/costs`). Org minute usage for the billing period is at `GET /api/billing/usage` (included / used / purchased remaining). **Hard stop when both included remaining and purchased balance are zero** — billable tools and outbound email→call alerts are blocked; the assistant speaks `spokenCapReached` verbatim (buy more minutes, upgrade, or wait). Warn at 80% of included; when included is exhausted but purchased remains, speak that purchased minutes are in use. Prepaid packs: 30/$18, 60/$30, 120/$48 via Stripe one-time checkout.

**Accessibility (blind patrons):** briefing and “read my emails” speak messages **one at a time** — From, Subject, then body or snippet — then pause for next / more detail / draft in the app. **Nothing sends email from a call.**

Tool results include per-email readable text (prefer `bodyText`, else Gmail/Outlook `snippet`). If only metadata exists, the assistant says so and still reads subject/from.

### Selecting messages to read

The readable window contains up to 20 messages and is newest-first by default. Every
selection gets a short spoken confirmation, then `Email N of M` numbering relative
to that selection. “Next” stays in the active selection.

- “Read the first 10” reads the 10 most recent messages.
- “Read the last 10” and “read the oldest 10” read the oldest 10 in the window,
  oldest first.
- “Read the new 3” reads up to 3 Primary messages received after
  `CallInIdentity.lastSuccessfulCallAt`; “just the new ones” reads all that match.
- “Read number 4” reads only item 4. A following “next” continues with the item
  after number 4.
- “Read the next 3” selects the next 3 after the message most recently read.

Counts are clamped to 1–20 and to the messages actually available. The spoken
result states the real count when the request is larger. “New” with no matches
says there are no new emails and never substitutes old or non-Primary mail.
Primary remains the default; explicit promotions/everything requests can be
combined with a count.

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
   `https://inboxchief.email/api/call-in/vapi/webhook`
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

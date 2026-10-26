# Research agent — operator guide

This is the web research and notes path at `/dashboard/agent`. Phone call-in is unchanged. Email still does not send without the existing confirmation rules. A session summary to the owner's verified address sends only when they say so, or when they turn on automatic summaries.

Courtney's acceptance test — using this on his own device without Eddie operating it — has **not** been passed. Do not tell him it has.

## What the owner does

1. Sign in with **his** account at `/login`. Do not use Eddie's browser profile or Eddie's password.
2. Open **Research and notes**.
3. Press **Talk**, or type in **Type instead of speaking**. There is no wake word.
4. Example: “Research whether olaparib increases DCLK1 expression. Find original papers, explain the evidence, save this under COARE research, and email me.”
5. **Stop speaking** interrupts playback only. **Cancel research** is the control that stops a task.
6. Leave and come back with **Continue previous work**, or say “Continue our olaparib research.”

## Credentials the server needs

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres. Run `npm run db:migrate` so the research tables exist. |
| `AUTH_SECRET` | Existing session secret. |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | OpenAI Chat Completions. Default model `gpt-5.6-sol` (override if the key cannot call it). |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | Anthropic Messages API, header `anthropic-version: 2026-10-21`. Default `claude-sonnet-5-5`. No temperature is sent. |
| `XAI_API_KEY` / `XAI_MODEL` | xAI Chat Completions at `https://api.x.ai/v1/chat/completions`. Default `grok-4.3`. |
| `NEXT_PUBLIC_APP_URL` | Link inside session emails. |
| `RESEARCH_TIMEZONE` | Default `America/Chicago` for “yesterday” and “last Tuesday”. |
| Gmail OAuth | Existing mailbox connect. Required to send. Research notes still save without it. |

These are **API keys billed by the provider**. They are not ChatGPT, Claude, or Grok consumer subscriptions, and those products' memories and tools are not used.

Set at least one provider key. If none is set, publication search still runs and the answer is labeled as an assembly of retrieved records, not a model answer.

## Cost

The page shows an **estimate** from token counts (about $2 / million input tokens and $10 / million output tokens for the default models). It is not an invoice. The default monthly cap is $20 (`monthlyCostLimitCents` 2000). Europe PMC search is unauthenticated and has no per-call fee in this app. Gmail sends use the existing Google quota.

## Backup and restore

1. Signed in as the owner, open `GET /api/research/export` (JSON) or `?format=md` (Markdown). The Research page has both links and a **Restore from an export file** control.
2. Restore is `POST /api/research/import` with that JSON. It copies records into the signed-in account and does not send email.
3. Database backup remains a Postgres backup of the whole database (`Research*` tables included). Restoring the database is the operator path; the JSON file is the portable copy the owner can hold.

## Account recovery and delegated access

- Password reset stays at `/forgot-password`. Courtney needs his own email inbox to receive it, or a maintainer uses the existing operator reset script with his account id — not by signing in as him and staying signed in.
- `OPERATOR_EMAILS` can open Admin onboard. The technical administrator role still does **not** receive mailbox access by default, and research records are filtered by `organizationId`, `workspaceId`, and `ownerId`. Operators do not get a transcript browser.
- If workspace setup is missing, the agent says a maintainer has to finish it. That step is not independently accessible until the account exists.

## Failure records

Failed tasks store an error **code** (`provider_rate_limit`, `research_unavailable`, `storage`, `email_unknown`, and so on). Application logs include the task id and code only. Do not add transcript text to logs.

Email statuses:

- `DRAFT` — prepared, not sent
- `QUEUED` — send started
- `PROVIDER_ACCEPTED` — Gmail returned a message id. This is **not** proof the recipient's inbox got it
- `UNKNOWN` — timeout or ambiguous failure. Do not retry until the row is checked
- `FAILED` — the provider rejected the send
- `DELIVERED` — reserved for a real delivery receipt. The app does not set this from a successful API call

## Screen reader checks still to do by a person

Automated tests do not run VoiceOver or NVDA. Before calling the page ready for Courtney, a person should confirm:

- Talk is focused on arrival and is reachable by keyboard.
- Status changes are announced once, and the full answer is not also read by the screen reader while speech synthesis is on.
- Escape stops speech and does not cancel research.
- The typed box works with speech recognition denied.
- Stop speaking and Cancel research are separate and named.

## Known limits

- No wake word.
- Full text is stored only when Europe PMC returns open-access XML. Otherwise the record is marked abstract, snippet, or inaccessible.
- Live model calls need `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `XAI_API_KEY`. With none of those set, research still searches Europe PMC and says the answer is an assembly of records, not a model answer.
- “Courtney completed this on his own device” is not done.

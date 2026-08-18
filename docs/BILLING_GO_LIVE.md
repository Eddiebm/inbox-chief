# Billing go-live checklist (Stripe)

Inbox Chief self-serve billing is built and works end-to-end in **Stripe test
mode** today. Going live is an **environment-variable change only** — no code
change is required. When the seven required variables below are set (with live
keys), `GET /api/health` → `checks.stripe.liveReady` flips to `true`
automatically, checkout starts charging, and the webhook keeps Neon in sync.

## What already works without any keys

- `/dashboard/billing` renders plans, current-plan highlight, trial countdown,
  usage meter, and (when a paid subscription exists) a **Manage subscription**
  button — all keyboard + screen-reader accessible, plain language.
- Checkout / portal / webhook endpoints respond safely and say
  "billing not live" instead of erroring.
- Plan gating (Pro email→call alerts, premium voice) reads **real** subscription
  state: trial, active, past-due grace, and canceled all behave correctly.

## Required Vercel env vars (flip `liveReady` to true)

Set these in **Vercel → Project → Settings → Environment Variables**
(Production, and Preview if you want previews live):

| Env var | What it is | Where to get it in the Stripe Dashboard |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | Secret API key (starts `sk_live_…`, or `sk_test_…` for test mode) | Developers → API keys → **Secret key** |
| `STRIPE_PRICE_PATRON` | Price ID for the Patron plan ($29/mo) | Product catalog → Patron product → its recurring **Price** → copy the `price_…` ID |
| `STRIPE_PRICE_PRO` | Price ID for the Pro plan ($79/mo) | Product catalog → Pro product → its recurring **Price** → copy the `price_…` ID |
| `STRIPE_PRICE_MINUTES_30` | One-time Price ID for 30 additional minutes ($18) | Product catalog → 30-minute pack → one-time **Price** |
| `STRIPE_PRICE_MINUTES_60` | One-time Price ID for 60 additional minutes ($30) | Product catalog → 60-minute pack → one-time **Price** |
| `STRIPE_PRICE_MINUTES_120` | One-time Price ID for 120 additional minutes ($48) | Product catalog → 120-minute pack → one-time **Price** |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for the webhook endpoint (starts `whsec_…`) | Developers → Webhooks → your endpoint → **Signing secret** → Reveal |

`liveReady` = `STRIPE_SECRET_KEY` **and** `STRIPE_PRICE_PATRON` **and**
`STRIPE_PRICE_PRO`, all three `STRIPE_PRICE_MINUTES_*` values, **and**
`STRIPE_WEBHOOK_SECRET` all present. It is computed
live from env in `src/app/api/health/route.ts` — never hardcoded.

## One-time setup in Stripe (test mode first)

1. **Create products + prices**
   - Product "Inbox Chief Patron" → recurring price **$29 / month** → copy price ID → `STRIPE_PRICE_PATRON`.
   - Product "Inbox Chief Pro" → recurring price **$79 / month** → copy price ID → `STRIPE_PRICE_PRO`.
   - Product "30 call minutes" → one-time price **$18** → `STRIPE_PRICE_MINUTES_30`.
   - Product "60 call minutes" → one-time price **$30** → `STRIPE_PRICE_MINUTES_60`.
   - Product "120 call minutes" → one-time price **$48** → `STRIPE_PRICE_MINUTES_120`.
   - (Business is "contact us" — no price needed.)
2. **Enable the Billing Portal**: Settings → Billing → Customer portal → activate
   (allow cancel + update payment method). Required for the Manage-subscription link.
3. **Create the webhook endpoint**
   - URL: `https://inboxchief.email/api/billing/webhook`
   - Events to send:
     - `checkout.session.completed`
     - `checkout.session.async_payment_succeeded`
     - `customer.subscription.created`
     - `customer.subscription.updated`
     - `customer.subscription.deleted`
     - `invoice.payment_failed`
   - Copy the endpoint's **Signing secret** → `STRIPE_WEBHOOK_SECRET`.
4. **Grab the secret key** → `STRIPE_SECRET_KEY`.

## Verify (test mode)

- Local webhook: `stripe listen --forward-to localhost:3000/api/billing/webhook`
  gives you a `whsec_…` for local `STRIPE_WEBHOOK_SECRET`.
- Trigger transitions: `stripe trigger checkout.session.completed`,
  `stripe trigger invoice.payment_failed`,
  `stripe trigger customer.subscription.deleted`.
- Use Stripe test card `4242 4242 4242 4242` (any future expiry / CVC) at checkout.
- Confirm `GET /api/health` shows `checks.stripe.liveReady: true` once all seven
  vars are set.

## Flip to live

Repeat the product/webhook/key steps in **live mode** (top-left toggle in the
Stripe Dashboard), then replace the seven Vercel vars with the live values and
redeploy. No code change. Keep `sk_live_…` / `whsec_…` secrets **only** in
Vercel env — never commit them.

## Prepaid minute packs

Purchased minutes roll over until consumed. Calls use included plan minutes
first, then the purchased balance. There is no $0.60 metered continuation:
`hardCapReached` means both included and purchased minutes are exhausted.

- 30 minutes for $18 = $0.60/min; gross margin is about $0.38–$0.48/min at
  estimated COGS of $0.12–$0.22/min.
- 60 minutes for $30 = $0.50/min; gross margin is about $0.28–$0.38/min.
- 120 minutes for $48 = $0.40/min; gross margin is about $0.18–$0.28/min.

Only paid one-time Checkout Sessions are credited. The unique Stripe Checkout
Session ID makes retries idempotent, and every credit is audited in
`CallMinutePackPurchase`.

## State model (what the webhook writes to Neon)

| Stripe event | `Subscription.status` result | Effect on Pro features |
| --- | --- | --- |
| `checkout.session.completed` | `ACTIVE` (refined by the subscription event) | Pro features on |
| `customer.subscription.updated` (trialing) | `TRIALING` | On until trial ends |
| `customer.subscription.updated` (active) | `ACTIVE` | On |
| `invoice.payment_failed` | `PAST_DUE` | On (grace) + "update your card" prompt |
| `customer.subscription.deleted` | `CANCELED` | Off (downgrade to free) |

Expired trial with no paid subscription also downgrades to free automatically
(computed in `src/lib/billing/entitlements.ts`).

# One-shot production deploy (Eddie)

Everything else is already done: Neon migrations, VAPI assistant + webhook secret header, tests (394/394).

**You have two steps:**

## 1. Fill Stripe lines in `secrets.local.env`

Open `secrets.local.env` (gitignored, already created in your repo root by the agent).

Only edit the seven `STRIPE_*` lines — everything else is pre-filled. See [BILLING_GO_LIVE.md](../docs/BILLING_GO_LIVE.md) for Stripe Dashboard copy-paste.

Skip Stripe for now if you only need call-in working; billing stays offline until those lines are set.

## 2. Run one command

```bash
cd /Users/eddiebannerman-menson/Projects/inbox-chief
chmod +x scripts/bootstrap-production.sh   # first time only
./scripts/bootstrap-production.sh
```

The script will:

1. Confirm you are logged into Vercel as **eddiebms-projects** (`vercel login` if not)
2. Link project **inbox-chief**
3. Push all vars from `secrets.local.env` to Production + Preview
4. Run `vercel --prod`

### Verify after deploy

```bash
curl -s https://inboxchief.email/api/health | python3 -m json.tool
```

Green means: `ok: true`, `vapiWebhookAuthConfigured: true`, `sessionSecretsConfigured: true`.

### Optional: flip apex/www redirect

Vercel → **inbox-chief** → **Settings → Domains** → make **inboxchief.email** Production, **www** → 308 to apex.

---

## Already automated (no action)

| Item | Status |
| --- | --- |
| `VAPI_WEBHOOK_SECRET` generated | ✓ in `secrets.local.env` |
| VAPI assistant `7adc3d95-…` patched | ✓ server URL + `X-Vapi-Secret` header |
| Neon migrations | ✓ 15/15 applied |
| Tests | ✓ 394/394 |
| `AUTH_SECRET` generated | ✓ in `secrets.local.env` |

## Still manual later (not blocking deploy)

- **Google OAuth verification** — patrons need test-user bridge until Google approves ([GOOGLE_OAUTH_PUBLISH.md](../docs/GOOGLE_OAUTH_PUBLISH.md))
- **Stripe products/webhook** — only if you skipped STRIPE_* above

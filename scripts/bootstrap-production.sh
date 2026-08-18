#!/usr/bin/env bash
# One-shot Vercel production bootstrap for Inbox Chief.
# Prerequisites: vercel CLI, logged into eddiebms-projects, secrets.local.env filled.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SECRETS_FILE="${SECRETS_FILE:-$ROOT/secrets.local.env}"
SCOPE="${VERCEL_SCOPE:-eddiebms-projects}"
PROJECT="${VERCEL_PROJECT:-inbox-chief}"
ENV_TARGETS=(production preview)

die() { echo "ERROR: $*" >&2; exit 1; }

command -v vercel >/dev/null || die "Install Vercel CLI: npm i -g vercel"

WHOAMI="$(vercel whoami 2>/dev/null || true)"
[[ -n "$WHOAMI" ]] || die "Run: vercel login   (must be Eddie's eddiebms-projects account)"

echo "Vercel user: $WHOAMI"
echo "Target scope: $SCOPE / project: $PROJECT"
echo ""
echo "If this is the wrong account, run: vercel logout && vercel login"
echo ""

[[ -f "$SECRETS_FILE" ]] || die "Missing $SECRETS_FILE — copy secrets.local.env.example and fill STRIPE_* lines."

# Required keys (non-Stripe) — agent pre-fills these in secrets.local.env
REQUIRED=(
  DATABASE_URL
  AUTH_SECRET
  VAPI_WEBHOOK_SECRET
  VAPI_API_KEY
  VAPI_ASSISTANT_ID
  GOOGLE_CLIENT_ID
  GOOGLE_CLIENT_SECRET
  GOOGLE_REDIRECT_URI
  NEXT_PUBLIC_APP_URL
  CALL_IN_PUBLIC_BASE_URL
)

STRIPE_KEYS=(
  STRIPE_SECRET_KEY
  STRIPE_WEBHOOK_SECRET
  STRIPE_PRICE_PATRON
  STRIPE_PRICE_PRO
  STRIPE_PRICE_MINUTES_30
  STRIPE_PRICE_MINUTES_60
  STRIPE_PRICE_MINUTES_120
)

declare -A ENV_VARS=()
while IFS= read -r line || [[ -n "$line" ]]; do
  line="${line%%#*}"
  line="$(echo "$line" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
  [[ -z "$line" ]] && continue
  [[ "$line" != *=* ]] && continue
  key="${line%%=*}"
  val="${line#*=}"
  key="$(echo "$key" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
  val="$(echo "$val" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | sed 's/^["'"'"']//;s/["'"'"']$//')"
  ENV_VARS["$key"]="$val"
done < "$SECRETS_FILE"

missing=()
for k in "${REQUIRED[@]}"; do
  v="${ENV_VARS[$k]:-}"
  [[ -n "$v" ]] || missing+=("$k")
done
(( ${#missing[@]} == 0 )) || die "Missing required values in $SECRETS_FILE: ${missing[*]}"

stripe_missing=()
for k in "${STRIPE_KEYS[@]}"; do
  v="${ENV_VARS[$k]:-}"
  [[ -n "$v" ]] || stripe_missing+=("$k")
done
if (( ${#stripe_missing[@]} > 0 )); then
  echo "WARN: Stripe not fully configured (${stripe_missing[*]}). Billing stays offline until filled."
  echo "      Continuing deploy — call-in and signup will work; checkout will not."
  echo ""
fi

cd "$ROOT"

if [[ ! -f .vercel/project.json ]]; then
  echo "Linking project $PROJECT (scope $SCOPE)…"
  vercel link --project "$PROJECT" --scope "$SCOPE" --yes
else
  echo "Using existing .vercel/project.json"
fi

add_env() {
  local name="$1"
  local value="$2"
  for target in "${ENV_TARGETS[@]}"; do
    vercel env add "$name" "$target" \
      --scope "$SCOPE" \
      --value "$value" \
      --force \
      --yes \
      --sensitive \
      --non-interactive
  done
}

echo "Pushing environment variables to Vercel (${ENV_TARGETS[*]})…"
for key in "${!ENV_VARS[@]}"; do
  val="${ENV_VARS[$key]}"
  [[ -n "$val" ]] || continue
  echo "  → $key"
  add_env "$key" "$val"
done

echo ""
echo "Deploying production…"
vercel --prod --scope "$SCOPE" --yes

echo ""
echo "Done. Verify:"
echo "  curl -s https://inboxchief.email/api/health | python3 -m json.tool"
echo ""
echo "Expect: vapiWebhookAuthConfigured=true, sessionSecretsConfigured=true, ok=true"

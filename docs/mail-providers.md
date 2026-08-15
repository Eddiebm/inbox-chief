# Multi-provider mailboxes

Inbox Chief connects mail through a provider-agnostic layer under
`src/lib/mail/providers/`.

## Live vs gated

| Provider | Auth | Status |
|----------|------|--------|
| **Gmail** | OAuth (`/api/gmail/*`) | Live connect + metadata sync when Google env is set |
| **Outlook / Microsoft 365** | OAuth + Graph (`/api/outlook/*`) | Live connect + metadata sync when Microsoft env is set |
| **Yahoo** | IMAP app password | Connect + encrypted credential storage; header sync on Node + `imapflow` |
| **iCloud** | IMAP app-specific password | Same as Yahoo |
| **Other IMAP** | IMAP + SMTP hosts | Same as Yahoo |

Send is **never** automatic. `Mail.Send` / `gmail.send` exist only for the
explicit human approval → confirm-send path (provider send adapters can be
wired later; the product invariant blocks auto-send today).

## Azure app registration (Outlook)

1. Azure Portal → **Microsoft Entra ID** → **App registrations** → **New registration**
2. Name e.g. `Inbox Chief`, accounts: **personal Microsoft + work/school** (`common`)
3. Redirect URI (Web): `https://YOUR_HOST/api/outlook/callback`
4. **Certificates & secrets** → New client secret → copy value into `MICROSOFT_CLIENT_SECRET`
5. **API permissions** → Microsoft Graph → Delegated:
   - `Mail.Read`
   - `Mail.Send`
   - `openid`, `profile`, `email`, `offline_access`
6. Grant admin consent if your org requires it
7. Set env: `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID=common` (or your tenant GUID), `MICROSOFT_REDIRECT_URI`, `MOCK_INTEGRATIONS=false`

Do not invent fake client secrets — leave blank until the Azure secret exists.

## IMAP notes

- Prefer **app passwords** (Yahoo Account Security; Apple ID → App-Specific Passwords).
- Credentials are AES-GCM encrypted with `TOKEN_ENCRYPTION_KEY` or `AUTH_SECRET`.
- Every DB read/write includes `organizationId` + `workspaceId` (+ `mailboxId`).
- IMAP TCP does not run on Cloudflare Workers; Vercel Node / local Node can probe login and sync headers via `imapflow`.

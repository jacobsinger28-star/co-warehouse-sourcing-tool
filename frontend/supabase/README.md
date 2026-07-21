# Supabase — tenant schema & rollout

SQL migrations for the multi-tenant layer. The server reaches these tables through
PostgREST using a **server-only** `SUPABASE_SERVICE_ROLE_KEY` (see `../db.mjs`); the
public anon key and user JWTs are locked out by RLS.

## Migrations

| File | Adds | Phase |
|---|---|---|
| `migrations/0001_tenants.sql` | `tenants`, `tenant_members` (+ RLS) | 0 |
| `migrations/0002_tenant_secrets.sql` | `tenant_secrets` (+ RLS), `tenants.dek_wrapped`/`kek_version` | 1 |

Apply either way:
- **Dashboard:** Supabase → SQL editor → paste the file → Run.
- **CLI:** `supabase db push` (with the project linked).

## Turning tenancy on without locking anyone out

Tenancy is gated on `SUPABASE_SERVICE_ROLE_KEY`. Until it's set, the server ignores
these tables and uses the legacy `ALLOWED_EMAILS` allowlist — so the order is:

1. **Apply** `0001_tenants.sql`.
2. **Seed tenant-1** from today's allowlist (uses the service-role key locally, does
   not require restarting the server):
   ```sh
   SUPABASE_URL='https://<ref>.supabase.co' SUPABASE_SERVICE_ROLE_KEY='<service-role>' \
     node tools/seed_tenant.mjs --slug simicapital --name 'SimiCapital' \
       --members "$ALLOWED_EMAILS" --role owner
   ```
   `--members "@simicap.com"` means "anyone at that domain," identical to the env var.
3. **Set `SUPABASE_SERVICE_ROLE_KEY`** in Railway → Variables. On the next boot the
   log prints `tenancy ENABLED` and entry is decided by membership. Existing users
   keep access because they were seeded in step 2.

To roll back: unset `SUPABASE_SERVICE_ROLE_KEY` → the server returns to the legacy
allowlist immediately.

> Never expose the service-role key to the browser or commit it. It bypasses RLS.

## BYOK secrets (Phase 1)

Provider keys are envelope-encrypted per tenant. The master **KEK** lives only in
Railway; each tenant has a random **DEK** wrapped by the KEK; each secret field is
encrypted with its tenant's DEK. The server's `SecretResolver` is the only decryptor.

While `SECRETS_KEK` is unset, `secretsEnabled()` is false and every provider keeps
using its process env var (`PIPEDRIVE_API_TOKEN`, `PHONEBURNER_*`, `ANTHROPIC_API_KEY`)
via the resolver's legacy fallback — so shipping Phase 1 changes nothing at runtime.

To turn BYOK on for a real tenant:

1. **Apply** `0002_tenant_secrets.sql`.
2. **Generate + set the KEK** (32 bytes, base64) in Railway → Variables:
   ```sh
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # → SECRETS_KEK
   ```
3. **Migrate the tenant's keys** into `tenant_secrets` (value read from an env var,
   never argv). Do this for each provider the tenant uses:
   ```sh
   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… SECRETS_KEK=… PIPEDRIVE_API_TOKEN=… \
     node tools/seed_secret.mjs --tenant simicapital \
       --provider crm.pipedrive --field api_token --from-env PIPEDRIVE_API_TOKEN
   ```
   Providers/fields: `crm.pipedrive/api_token`, `dialer.phoneburner/{access_token |
   client_id,client_secret,redirect_uri}`, `llm.anthropic/api_key`.

> The env-var fallback applies **only** to the legacy/default tenant. A real tenant
> with no key stored resolves to `null` (its integration stubs out) — it never borrows
> another tenant's env credentials. So migrate the keys before/at the same time as you
> seed the tenant, or SimiCapital's integrations will stub until you do.
>
> Offboard a tenant = drop its `dek_wrapped` (crypto-shred: all its secrets become
> permanently undecryptable). Never log or return a decrypted value; the Settings UI
> is write-only.

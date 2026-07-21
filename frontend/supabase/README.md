# Supabase — tenant schema & rollout

SQL migrations for the multi-tenant layer. The server reaches these tables through
PostgREST using a **server-only** `SUPABASE_SERVICE_ROLE_KEY` (see `../db.mjs`); the
public anon key and user JWTs are locked out by RLS.

## Migrations

| File | Adds | Phase |
|---|---|---|
| `migrations/0001_tenants.sql` | `tenants`, `tenant_members` (+ RLS) | 0 |

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

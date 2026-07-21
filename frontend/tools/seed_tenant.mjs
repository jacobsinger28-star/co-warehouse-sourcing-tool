#!/usr/bin/env node
// seed_tenant.mjs — create/refresh a tenant and its member allowlist.
//
// Run ONCE per environment right after applying supabase/migrations/0001_tenants.sql
// and BEFORE setting SUPABASE_SERVICE_ROLE_KEY on the running server, so current
// users keep access (now via membership) the moment tenancy flips on. Idempotent:
// re-running upserts, never duplicates.
//
//   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
//     node tools/seed_tenant.mjs --slug simicapital --name "SimiCapital" \
//       --members "@simicap.com,raz@x.com" [--role owner]
//
// To reproduce today's access exactly, pass the current ALLOWED_EMAILS value as
// --members ('@simicap.com' means "anyone at that domain", same as the env var).
import { parseArgs } from 'node:util'
import { tenancyEnabled, dbUpsert } from '../db.mjs'

const { values } = parseArgs({
  options: {
    slug: { type: 'string' },
    name: { type: 'string' },
    members: { type: 'string', default: '' },
    role: { type: 'string', default: 'member' },
  },
})

if (!tenancyEnabled()) {
  console.error('⛔ set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY before seeding')
  process.exit(2)
}
if (!values.slug || !values.name) {
  console.error('usage: node tools/seed_tenant.mjs --slug <slug> --name <name> --members "a@b.com,@c.com" [--role owner]')
  process.exit(2)
}

const emails = values.members.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)

const [tenant] = await dbUpsert('tenants', { slug: values.slug, name: values.name }, { onConflict: 'slug' })
if (!tenant?.id) { console.error('⛔ tenant upsert returned no id', tenant); process.exit(1) }
console.log(`✓ tenant ${tenant.slug} (${tenant.id})`)

if (emails.length) {
  const rows = emails.map((email) => ({ tenant_id: tenant.id, email, role: values.role }))
  await dbUpsert('tenant_members', rows, { onConflict: 'tenant_id,email' })
  console.log(`✓ ${rows.length} member(s): ${emails.join(', ')} (role=${values.role})`)
} else {
  console.log('⚠ no --members given — tenant has no members yet (nobody can enter it)')
}

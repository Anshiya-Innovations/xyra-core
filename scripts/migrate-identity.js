// One-off migration for the session-token / membership redesign:
//   1. Creates the new master tables (Users, Memberships, PlatformAdmins) in
//      xyra_master — CREATE TABLE IF NOT EXISTS generated from db/master/identity.cds,
//      so it can't drift from the model and never touches existing tables.
//   2. Backfills a Membership for every user of every provisioned tenant
//      (persona = the user's role code in that tenant). Idempotent — re-runnable.
//
// Credentials come from .cdsrc-private.json like the server's, never hardcoded.
// Usage: node scripts/migrate-identity.js [--dry-run]

const cds = require('@sap/cds')
const { getPool, tenantEntities } = require('../lib/tenant/TenantPoolManager')
const { ensureMembership } = require('../lib/auth/identity')

const NEW_TABLES = /^CREATE TABLE (xyra_master_(Users|Memberships|PlatformAdmins)) \(/
const DRY = process.argv.includes('--dry-run')

async function main() {
  const csn = await cds.load('db')
  cds.model = cds.linked(cds.compile.for.nodejs(csn))
  const db = await cds.connect.to('db')

  const ddl = cds.compile.to.sql(csn, { dialect: 'postgres' }).filter((s) => NEW_TABLES.test(s))
  for (const stmt of ddl) {
    console.log(`${DRY ? '[dry] ' : ''}ensure table ${stmt.match(NEW_TABLES)[1]}`)
    if (!DRY) await db.run(stmt.replace(/^CREATE TABLE /, 'CREATE TABLE IF NOT EXISTS '))
  }

  const { Tenants, Provisioning } = cds.entities('xyra.master')
  const jobs = await SELECT.from(Provisioning).columns('tenant_ID', 'databaseName').where({ status: 'COMPLETED' })
  for (const job of jobs) {
    const tenant = await SELECT.one.from(Tenants).columns('companyName', 'status').where({ ID: job.tenant_ID })
    console.log(`\n${tenant ? tenant.companyName : '?'} (${job.databaseName}, ${tenant ? tenant.status : 'missing'})`)

    const tenantDb = await getPool(job.tenant_ID, job.databaseName)
    const { Users, Roles } = await tenantEntities()
    const [users, roles] = await Promise.all([tenantDb.run(SELECT.from(Users)), tenantDb.run(SELECT.from(Roles))])
    const codeOf = new Map(roles.map((r) => [r.ID, r.code]))

    for (const u of users) {
      const persona = codeOf.get(u.role_ID)
      if (!persona) { console.log(`  skip (no role): ${u.email}`); continue }
      const status = u.status === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE'
      console.log(`  ${DRY ? '[dry] ' : ''}${u.email} -> ${persona} (${status})`)
      if (!DRY) await ensureMembership({ email: u.email, name: u.name, tenantId: job.tenant_ID, tenantUserId: u.ID, persona, status })
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Migration failed:', err)
    process.exit(1)
  })

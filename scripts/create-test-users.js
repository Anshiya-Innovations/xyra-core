// Creates the 4 non-admin test accounts (Reviewer 1, Reviewer 2, Escalation Manager,
// Auditor) directly in one tenant's database, for testing the xyra-web login flow.
// The admin account isn't created here — it already exists from provisioning, with
// its own one-time generated password.
//
// ponytail: direct DB insert, not a "POST /api/users" endpoint — no such endpoint
// exists yet (that's the Admin dashboard's future User Management tile). Fine for
// seeding one fixed test tenant; build the real endpoint when that tile needs it.
//
// Usage: node scripts/create-test-users.js <tenant_database_name>

const cds = require('@sap/cds')
const { getPool, tenantEntities } = require('../lib/tenant/TenantPoolManager')
const { hashPassword } = require('../lib/auth/password')

const TEST_PASSWORD = 'Test@1234'

const TEST_USERS = [
  { name: 'Reviewer One', email: 'reviewer1@xyrademo.test', roleCode: 'REVIEWER' },
  { name: 'Reviewer Two', email: 'reviewer2@xyrademo.test', roleCode: 'REVIEWER' },
  { name: 'Escalation Manager', email: 'escalationmanager@xyrademo.test', roleCode: 'ESCALATION_MANAGER' },
  { name: 'Auditor One', email: 'auditor@xyrademo.test', roleCode: 'AUDITOR' }
]

async function main() {
  const dbName = process.argv[2]
  if (!dbName) throw new Error('Usage: node scripts/create-test-users.js <tenant_database_name>')

  // ponytail: this standalone script only ever knows the database name, not the
  // real tenant UUID — using dbName as the pool key is fine here since this
  // process's cache never overlaps with the running server's.
  const tenantDb = await getPool(dbName, dbName)
  const { Users, Roles } = await tenantEntities()

  for (const u of TEST_USERS) {
    const existing = await tenantDb.run(SELECT.one.from(Users).where({ email: u.email }))
    if (existing) { console.log(`skip (already exists): ${u.email}`); continue }

    const role = await tenantDb.run(SELECT.one.from(Roles).where({ code: u.roleCode }))
    if (!role) throw new Error(`Role not found: ${u.roleCode} — did provisioning seed it?`)

    const passwordHash = await hashPassword(TEST_PASSWORD)
    await tenantDb.run(INSERT.into(Users).entries({
      ID: cds.utils.uuid(),
      name: u.name,
      email: u.email,
      passwordHash,
      role_ID: role.ID,
      status: 'ACTIVE'
    }))
    console.log(`created: ${u.email} (${u.roleCode})`)
  }

  console.log(`\nAll 4 test accounts above use password: ${TEST_PASSWORD}`)
}

main().catch((err) => {
  console.error('\n❌', err.message)
  process.exit(1)
})

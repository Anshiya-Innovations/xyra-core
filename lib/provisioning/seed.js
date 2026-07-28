const cds = require('@sap/cds')
const { tenantEntities } = require('../tenant/TenantPoolManager')
const { hashPassword, generateTempPassword } = require('../auth/password')

// Reviewer 1 / Reviewer 2 / etc. are just separate USER accounts with the REVIEWER
// role — not separate roles. The admin creates those accounts later (out of scope
// for provisioning, which only needs the catalog + the one bootstrap admin user).
const DEFAULT_ROLES = [
  { code: 'ADMIN', name: 'Administrator' },
  { code: 'REVIEWER', name: 'Reviewer' },
  { code: 'ESCALATION_MANAGER', name: 'Escalation Manager' },
  { code: 'AUDITOR', name: 'Auditor' }
]

// Idempotent: checks before inserting, so re-running on retry doesn't duplicate
// roles/settings or blow up on a unique constraint.
async function seedInitialData(db) {
  const { Roles, DashboardSettings } = await tenantEntities()

  for (const role of DEFAULT_ROLES) {
    const existing = await db.run(SELECT.one.from(Roles).where({ code: role.code }))
    if (!existing) await db.run(INSERT.into(Roles).entries({ ID: cds.utils.uuid(), ...role }))
  }

  const existingSettings = await db.run(SELECT.one.from(DashboardSettings))
  if (!existingSettings) {
    await db.run(INSERT.into(DashboardSettings).entries({ ID: cds.utils.uuid(), config: '{}' }))
  }
}

// Idempotent by email: re-running finds the already-created admin instead of duplicating
// it — and returns temporaryPassword: null in that case, since a new one isn't issued for
// an account that already exists (the first-run password was a one-time "show once" value).
async function createAdminUser(db, { name, email }) {
  const { Roles, Users } = await tenantEntities()

  const existing = await db.run(SELECT.one.from(Users).where({ email }))
  if (existing) return { user: existing, temporaryPassword: null }

  const adminRole = await db.run(SELECT.one.from(Roles).where({ code: 'ADMIN' }))
  const id = cds.utils.uuid()
  const temporaryPassword = generateTempPassword()
  const passwordHash = await hashPassword(temporaryPassword)

  await db.run(INSERT.into(Users).entries({
    ID: id,
    name,
    email,
    passwordHash,
    role_ID: adminRole && adminRole.ID,
    status: 'ACTIVE'
  }))

  return { user: { ID: id, name, email }, temporaryPassword }
}

module.exports = { seedInitialData, createAdminUser }

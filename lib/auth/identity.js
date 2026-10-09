const cds = require('@sap/cds')
const { sign } = require('./token')

// Control-plane identity (xyra.master.Users/Memberships). Every place that
// creates or removes a tenant user goes through here so the tenant Users row
// and its master Membership never drift apart.

// ponytail: 8h (a working day). A removed user's token stays valid until it
// expires — add a per-membership session version if revocation must be instant.
const TENANT_TOKEN_TTL = 8 * 60 * 60
const PLATFORM_TOKEN_TTL = 8 * 60 * 60

const normEmail = (email) => String(email || '').trim().toLowerCase()

// Find-or-create the global user, then upsert its membership in this tenant.
// Idempotent, so provisioning retries and the backfill script can re-run it.
async function ensureMembership({ email, name, tenantId, tenantUserId, persona, status = 'ACTIVE' }, tx = cds.db) {
  const { Users, Memberships } = cds.entities('xyra.master')
  const e = normEmail(email)

  let user = await tx.run(SELECT.one.from(Users).where({ email: e }))
  if (!user) {
    user = { ID: cds.utils.uuid(), email: e, name: name || null, status: 'ACTIVE' }
    await tx.run(INSERT.into(Users).entries(user))
  }

  const existing = await tx.run(SELECT.one.from(Memberships).where({ user_ID: user.ID, tenant_ID: tenantId }))
  if (existing) {
    await tx.run(UPDATE(Memberships).set({ tenantUserId, persona, status }).where({ ID: existing.ID }))
  } else {
    await tx.run(INSERT.into(Memberships).entries({ ID: cds.utils.uuid(), user_ID: user.ID, tenant_ID: tenantId, tenantUserId, persona, status }))
  }
  return user
}

async function removeMembership(tenantId, tenantUserId) {
  const { Memberships } = cds.entities('xyra.master')
  await DELETE.from(Memberships).where({ tenant_ID: tenantId, tenantUserId })
}

// The user's ACTIVE membership in this tenant, or null.
async function findMembership(email, tenantId) {
  const { Users, Memberships } = cds.entities('xyra.master')
  const user = await SELECT.one.from(Users).where({ email: normEmail(email), status: 'ACTIVE' })
  if (!user) return null
  const membership = await SELECT.one.from(Memberships).where({ user_ID: user.ID, tenant_ID: tenantId, status: 'ACTIVE' })
  return membership ? { user, membership } : null
}

function issueTenantToken(user, membership) {
  return sign({
    sub: user.ID,
    tenantId: membership.tenant_ID,
    tenantUserId: membership.tenantUserId,
    persona: membership.persona,
    email: user.email
  }, TENANT_TOKEN_TTL)
}

function issuePlatformToken(admin) {
  return sign({ sub: admin.ID, email: admin.email, platformAdmin: true }, PLATFORM_TOKEN_TTL)
}

module.exports = { ensureMembership, removeMembership, findMembership, issueTenantToken, issuePlatformToken, normEmail }

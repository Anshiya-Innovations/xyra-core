const cds = require('@sap/cds')
const { getPool, tenantEntities } = require('../../lib/tenant/TenantPoolManager')
const { verifyPassword } = require('../../lib/auth/password')
const { fullDomainFor } = require('../../lib/platform')

module.exports = function (srv) {
  srv.on('login', async (req) => {
    const fail = (message) => ({ success: false, message, tenantId: null, userId: null, name: null, email: null, role: null })

    const subdomain = (req.data.subdomain || '').trim()
    const email = (req.data.email || '').trim()
    const password = req.data.password || ''

    if (!subdomain || !email || !password) return fail('subdomain, email and password are required.')

    const { Tenants, Domains, Provisioning } = cds.entities('xyra.master')

    // Bare SELECT.from(...) calls each pay their own round trip to open+commit an
    // implicit transaction — measured against the live RDS instance, that's the
    // difference between ~1.3s and ~270ms per query. Sharing one transaction across
    // all 3 Master DB lookups here cuts several seconds off every login.
    const masterTx = cds.tx(req)

    // Same generic message whether the subdomain, the email, or the password is
    // wrong — don't give an attacker a way to enumerate which tenants/emails exist.
    const domain = await masterTx.run(SELECT.one.from(Domains).where({ domainName: fullDomainFor(subdomain) }))
    if (!domain) return fail('Invalid email or password.')

    const tenant = await masterTx.run(SELECT.one.from(Tenants).where({ ID: domain.tenant_ID }))
    if (!tenant || tenant.status !== 'ACTIVE') return fail('Invalid email or password.')

    const job = await masterTx.run(SELECT.one.from(Provisioning).where({ tenant_ID: domain.tenant_ID }))
    if (!job || !job.databaseName) return fail('Tenant database is not available.')

    const tenantDb = await getPool(tenant.ID, job.databaseName)
    const { Users, Roles } = await tenantEntities()

    // Same reasoning for the tenant DB side — one shared tx for the user + role
    // lookups instead of two separate implicit ones. Not tied to `req` (this is a
    // secondary connection, not the primary db), so it's committed explicitly.
    const tenantTx = tenantDb.tx()
    try {
      const user = await tenantTx.run(SELECT.one.from(Users).where({ email }))
      if (!user || user.status !== 'ACTIVE') return fail('Invalid email or password.')

      const ok = await verifyPassword(password, user.passwordHash)
      if (!ok) return fail('Invalid email or password.')

      const role = user.role_ID ? await tenantTx.run(SELECT.one.from(Roles).where({ ID: user.role_ID })) : null

      return {
        success: true,
        message: 'Login successful.',
        tenantId: tenant.ID,
        userId: user.ID,
        name: user.name,
        email: user.email,
        role: role ? role.code : null
      }
    } finally {
      await tenantTx.commit()
    }
  })
}

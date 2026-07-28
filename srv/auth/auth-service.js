const cds = require('@sap/cds')
const { connectToTenantDb, tenantEntities } = require('../../lib/provisioning/capDeploy')
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

    // Same generic message whether the subdomain, the email, or the password is
    // wrong — don't give an attacker a way to enumerate which tenants/emails exist.
    const domain = await SELECT.one.from(Domains).where({ domainName: fullDomainFor(subdomain) })
    if (!domain) return fail('Invalid email or password.')

    const tenant = await SELECT.one.from(Tenants).where({ ID: domain.tenant_ID })
    if (!tenant || tenant.status !== 'ACTIVE') return fail('Invalid email or password.')

    const job = await SELECT.one.from(Provisioning).where({ tenant_ID: tenant.ID })
    if (!job || !job.databaseName) return fail('Tenant database is not available.')

    const tenantDb = await connectToTenantDb(job.databaseName)
    const { Users, Roles } = await tenantEntities()

    const user = await tenantDb.run(SELECT.one.from(Users).where({ email }))
    if (!user || user.status !== 'ACTIVE') return fail('Invalid email or password.')

    const ok = await verifyPassword(password, user.passwordHash)
    if (!ok) return fail('Invalid email or password.')

    const role = user.role_ID ? await tenantDb.run(SELECT.one.from(Roles).where({ ID: user.role_ID })) : null

    return {
      success: true,
      message: 'Login successful.',
      tenantId: tenant.ID,
      userId: user.ID,
      name: user.name,
      email: user.email,
      role: role ? role.code : null
    }
  })
}

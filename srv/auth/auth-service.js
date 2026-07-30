const { getPool, tenantEntities } = require('../../lib/tenant/TenantPoolManager')
const { resolveTenantBySubdomain } = require('../../lib/tenant/resolveTenant')
const { verifyPassword } = require('../../lib/auth/password')

module.exports = function (srv) {
  srv.on('login', async (req) => {
    const fail = (message) => ({ success: false, message, tenantId: null, userId: null, name: null, email: null, role: null })

    const subdomain = (req.data.subdomain || '').trim()
    const email = (req.data.email || '').trim()
    const password = req.data.password || ''

    if (!subdomain || !email || !password) return fail('subdomain, email and password are required.')

    // Same generic message whether the subdomain, the email, or the password is
    // wrong — don't give an attacker a way to enumerate which tenants/emails exist.
    const resolved = await resolveTenantBySubdomain(req, subdomain)
    if (!resolved) return fail('Invalid email or password.')

    const tenantDb = await getPool(resolved.tenant.ID, resolved.databaseName)
    const { Users, Roles } = await tenantEntities()

    // One shared tx for the user + role lookups instead of two separate implicit
    // ones. Not tied to `req` (this is a secondary connection, not the primary
    // db), so it's committed explicitly.
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
        tenantId: resolved.tenant.ID,
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

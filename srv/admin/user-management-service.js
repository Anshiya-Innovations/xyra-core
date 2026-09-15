const cds = require('@sap/cds')
const { getPool, tenantEntities } = require('../../lib/tenant/TenantPoolManager')
const { resolveTenantBySubdomain } = require('../../lib/tenant/resolveTenant')
const { hashPassword } = require('../../lib/auth/password')

const VALID_ROLES = ['REVIEWER', 'ESCALATION_MANAGER', 'AUDITOR']

module.exports = function (srv) {
  srv.on('listUsers', async (req) => {
    const subdomain = (req.data.subdomain || '').trim()
    if (!subdomain) return []

    const resolved = await resolveTenantBySubdomain(req, subdomain)
    if (!resolved) return []

    const tenantDb = await getPool(resolved.tenant.ID, resolved.databaseName)
    const { Users, Roles, Organizations } = await tenantEntities()

    const tx = tenantDb.tx()
    try {
      const [users, roles, organizations] = await Promise.all([
        tx.run(SELECT.from(Users)),
        tx.run(SELECT.from(Roles)),
        tx.run(SELECT.from(Organizations))
      ])
      const roleById = new Map(roles.map(r => [r.ID, r]))
      const defaultOrg = organizations.find((org) => org.orgCode === 'DEFAULT') || organizations[0]
      const defaultOrganization = defaultOrg ? `${defaultOrg.orgCode} - ${defaultOrg.name}` : ''

      if (defaultOrganization) {
        await Promise.all(users
          .filter((user) => !user.organization)
          .map((user) => tx.run(UPDATE(Users).set({ organization: defaultOrganization }).where({ ID: user.ID }))))
      }

      return users.map(u => ({
        id: u.ID,
        name: u.name,
        email: u.email,
        organization: u.organization || defaultOrganization,
        role: u.role_ID && roleById.has(u.role_ID) ? roleById.get(u.role_ID).code : null,
        status: u.status,
        createdAt: u.createdAt
      }))
    } finally {
      await tx.commit()
    }
  })

  srv.on('createUser', async (req) => {
    const fail = (message) => ({ success: false, message, userId: null })

    const subdomain = (req.data.subdomain || '').trim()
    const name = (req.data.name || '').trim()
    const email = (req.data.email || '').trim()
    const password = req.data.password || ''
    const roleCode = (req.data.roleCode || '').trim().toUpperCase()
    const organization = (req.data.organization || '').trim()

    if (!subdomain || !name || !email || !password || !roleCode || !organization) {
      return fail('name, email, password, role and organization are required.')
    }
    if (!VALID_ROLES.includes(roleCode)) return fail('Admin accounts cannot be created here.')

    const resolved = await resolveTenantBySubdomain(req, subdomain)
    if (!resolved) return fail('Tenant not found.')

    const tenantDb = await getPool(resolved.tenant.ID, resolved.databaseName)
    const { Users, Roles } = await tenantEntities()

    const tx = tenantDb.tx()
    try {
      const existing = await tx.run(SELECT.one.from(Users).where({ email }))
      if (existing) return fail('A user with this email already exists.')

      const role = await tx.run(SELECT.one.from(Roles).where({ code: roleCode }))
      if (!role) return fail(`Role not found: ${roleCode}`)

      const id = cds.utils.uuid()
      const passwordHash = await hashPassword(password)
      await tx.run(INSERT.into(Users).entries({ ID: id, name, email, passwordHash, role_ID: role.ID, status: 'ACTIVE', organization }))

      return { success: true, message: 'User created.', userId: id }
    } finally {
      await tx.commit()
    }
  })

  srv.on('removeUser', async (req) => {
    const fail = (message) => ({ success: false, message })

    const subdomain = (req.data.subdomain || '').trim()
    const userId = (req.data.userId || '').trim()
    if (!subdomain || !userId) return fail('userId is required.')

    const resolved = await resolveTenantBySubdomain(req, subdomain)
    if (!resolved) return fail('Tenant not found.')

    const tenantDb = await getPool(resolved.tenant.ID, resolved.databaseName)
    const { Users } = await tenantEntities()

    const tx = tenantDb.tx()
    try {
      const user = await tx.run(SELECT.one.from(Users).where({ ID: userId }))
      if (!user) return fail('User not found.')
      if (user.email === resolved.tenant.adminEmail) return fail('Cannot remove the tenant admin account.')

      await tx.run(DELETE.from(Users).where({ ID: userId }))
      return { success: true, message: 'User removed.' }
    } finally {
      await tx.commit()
    }
  })

  srv.on('resetPassword', async (req) => {
    const fail = (message) => ({ success: false, message })

    const subdomain = (req.data.subdomain || '').trim()
    const userId = (req.data.userId || '').trim()
    const newPassword = req.data.newPassword || ''
    if (!subdomain || !userId || !newPassword) return fail('userId and newPassword are required.')

    const resolved = await resolveTenantBySubdomain(req, subdomain)
    if (!resolved) return fail('Tenant not found.')

    const tenantDb = await getPool(resolved.tenant.ID, resolved.databaseName)
    const { Users } = await tenantEntities()

    const tx = tenantDb.tx()
    try {
      const user = await tx.run(SELECT.one.from(Users).where({ ID: userId }))
      if (!user) return fail('User not found.')

      const passwordHash = await hashPassword(newPassword)
      await tx.run(UPDATE(Users).set({ passwordHash }).where({ ID: userId }))
      return { success: true, message: 'Password reset.' }
    } finally {
      await tx.commit()
    }
  })
}

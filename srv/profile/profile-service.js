const { getPool, tenantEntities } = require('../../lib/tenant/TenantPoolManager')
const { hashPassword, verifyPassword } = require('../../lib/auth/password')

module.exports = function (srv) {
  srv.on('getProfile', async (req) => {
    const fail = (message) => ({ success: false, message })

    const userId = req.user.attr.tenantUserId

    const { tenantId, databaseName } = req.user.attr

    const tenantDb = await getPool(tenantId, databaseName)
    const { Users, Roles } = await tenantEntities()

    const tx = tenantDb.tx()
    try {
      const user = await tx.run(SELECT.one.from(Users).where({ ID: userId }))
      if (!user) return fail('User not found.')

      const role = user.role_ID ? await tx.run(SELECT.one.from(Roles).where({ ID: user.role_ID })) : null

      return {
        success: true,
        message: 'OK',
        id: user.ID,
        name: user.name,
        email: user.email,
        phone: user.phone,
        department: user.department,
        organization: user.organization,
        role: role ? role.code : null,
        status: user.status
      }
    } finally {
      await tx.commit()
    }
  })

  srv.on('updateProfile', async (req) => {
    const fail = (message) => ({ success: false, message })

    const userId = req.user.attr.tenantUserId
    const name = (req.data.name || '').trim()
    if (!name) return fail('name is required.')

    const { tenantId, databaseName } = req.user.attr

    const tenantDb = await getPool(tenantId, databaseName)
    const { Users } = await tenantEntities()

    const tx = tenantDb.tx()
    try {
      const user = await tx.run(SELECT.one.from(Users).where({ ID: userId }))
      if (!user) return fail('User not found.')

      await tx.run(UPDATE(Users).set({
        name,
        phone: req.data.phone || null,
        department: req.data.department || null,
        organization: req.data.organization || null
      }).where({ ID: userId }))

      return { success: true, message: 'Profile updated.' }
    } finally {
      await tx.commit()
    }
  })

  srv.on('changePassword', async (req) => {
    const fail = (message) => ({ success: false, message })

    const userId = req.user.attr.tenantUserId
    const currentPassword = req.data.currentPassword || ''
    const newPassword = req.data.newPassword || ''
    if (!currentPassword || !newPassword) {
      return fail('Current password and new password are required.')
    }

    const { tenantId, databaseName } = req.user.attr

    const tenantDb = await getPool(tenantId, databaseName)
    const { Users } = await tenantEntities()

    const tx = tenantDb.tx()
    try {
      const user = await tx.run(SELECT.one.from(Users).where({ ID: userId }))
      if (!user) return fail('User not found.')

      const ok = await verifyPassword(currentPassword, user.passwordHash)
      if (!ok) return fail('Current password is incorrect.')

      const passwordHash = await hashPassword(newPassword)
      await tx.run(UPDATE(Users).set({ passwordHash }).where({ ID: userId }))

      return { success: true, message: 'Password changed.' }
    } finally {
      await tx.commit()
    }
  })
}

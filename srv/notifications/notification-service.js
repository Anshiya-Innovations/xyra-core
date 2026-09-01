const { resolveTenantBySubdomain } = require('../../lib/tenant/resolveTenant')
const notificationEngine = require('../../lib/notification_engine')

module.exports = function (srv) {
  srv.on('listNotifications', async (req) => {
    const fail = (message) => ({ success: false, message, notifications: [] })
    const subdomain = (req.data.subdomain || '').trim()
    if (!subdomain) return fail('subdomain is required.')

    const resolved = await resolveTenantBySubdomain(req, subdomain)
    if (!resolved) return fail('Tenant not found.')

    const rows = await notificationEngine.listNotifications(resolved.tenant.ID, resolved.databaseName)
    return {
      success: true,
      message: 'OK',
      notifications: rows.map((r) => ({
        id: r.ID,
        title: r.title,
        message: r.message,
        category: r.category,
        priority: r.priority,
        read: r.read,
        targetPage: r.targetPage,
        targetRecord: r.targetRecord,
        icon: r.icon,
        iconClass: r.iconClass,
        createdAt: r.createdAt
      }))
    }
  })

  srv.on('markAsRead', async (req) => {
    const fail = (message) => ({ success: false, message })
    const subdomain = (req.data.subdomain || '').trim()
    const id = (req.data.id || '').trim()
    if (!subdomain || !id) return fail('id is required.')

    const resolved = await resolveTenantBySubdomain(req, subdomain)
    if (!resolved) return fail('Tenant not found.')

    return notificationEngine.markAsRead(resolved.tenant.ID, resolved.databaseName, id)
  })

  srv.on('clearAll', async (req) => {
    const fail = (message) => ({ success: false, message })
    const subdomain = (req.data.subdomain || '').trim()
    if (!subdomain) return fail('subdomain is required.')

    const resolved = await resolveTenantBySubdomain(req, subdomain)
    if (!resolved) return fail('Tenant not found.')

    return notificationEngine.clearAll(resolved.tenant.ID, resolved.databaseName)
  })
}

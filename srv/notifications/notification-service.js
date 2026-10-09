const notificationEngine = require('../../lib/notification_engine')

module.exports = function (srv) {
  srv.on('listNotifications', async (req) => {
    const fail = (message) => ({ success: false, message, notifications: [] })

    const { tenantId, databaseName } = req.user.attr

    const rows = await notificationEngine.listNotifications(tenantId, databaseName)
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
    const id = (req.data.id || '').trim()
    if (!id) return fail('id is required.')

    const { tenantId, databaseName } = req.user.attr

    return notificationEngine.markAsRead(tenantId, databaseName, id)
  })

  srv.on('clearAll', async (req) => {
    const fail = (message) => ({ success: false, message })

    const { tenantId, databaseName } = req.user.attr

    return notificationEngine.clearAll(tenantId, databaseName)
  })
}

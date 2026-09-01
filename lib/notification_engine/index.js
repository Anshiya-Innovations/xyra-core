const cds = require('@sap/cds')
const { getPool, tenantEntities } = require('../tenant/TenantPoolManager')

// notification_engine: raises and reads the in-app notifications shown in
// xyra-web's bell popover (NotificationService.js / NotificationPopover.js).
// One shared module — same "engine, not a service" split as
// connection_engine — called by whichever tenant service handler needs to
// tell that tenant's users something happened. Wired in from:
//   - system-config-service.js createSystem (system added)
//   - system-config-service.js testSystemConnection (system went offline)
//   - auth-service.js login (user logged in)
// and exposed to the frontend via notification-service.cds/.js.

// Pure and separately testable: the actual row a notify() call inserts,
// including its defaults. Kept separate from the DB write below so the
// default/validation logic doesn't need a live tenant DB to test.
function buildNotificationRow(id, { title, message, category, priority, targetPage, targetRecord, icon, iconClass }) {
  if (!title || !message) throw new Error('notify() requires both title and message.')
  return {
    ID: id,
    title,
    message,
    category: category || 'TASK',
    priority: priority || 'MEDIUM',
    targetPage: targetPage || null,
    targetRecord: targetRecord || null,
    icon: icon || 'sap-icon://bell',
    iconClass: iconClass || 'xyraNotifyIconBlue',
    read: false
  }
}

async function notify(tenantId, databaseName, input) {
  const tenantDb = await getPool(tenantId, databaseName)
  const { Notifications } = await tenantEntities()
  const tx = tenantDb.tx()
  try {
    const id = cds.utils.uuid()
    await tx.run(INSERT.into(Notifications).entries(buildNotificationRow(id, input)))
    return { success: true, id }
  } finally {
    await tx.commit()
  }
}

async function listNotifications(tenantId, databaseName, { limit = 50 } = {}) {
  const tenantDb = await getPool(tenantId, databaseName)
  const { Notifications } = await tenantEntities()
  const tx = tenantDb.tx()
  try {
    return await tx.run(SELECT.from(Notifications).orderBy('createdAt desc').limit(limit))
  } finally {
    await tx.commit()
  }
}

async function markAsRead(tenantId, databaseName, id) {
  const tenantDb = await getPool(tenantId, databaseName)
  const { Notifications } = await tenantEntities()
  const tx = tenantDb.tx()
  try {
    await tx.run(UPDATE(Notifications).set({ read: true }).where({ ID: id }))
    return { success: true }
  } finally {
    await tx.commit()
  }
}

async function clearAll(tenantId, databaseName) {
  const tenantDb = await getPool(tenantId, databaseName)
  const { Notifications } = await tenantEntities()
  const tx = tenantDb.tx()
  try {
    await tx.run(UPDATE(Notifications).set({ read: true }).where({ read: false }))
    return { success: true }
  } finally {
    await tx.commit()
  }
}

module.exports = { notify, listNotifications, markAsRead, clearAll, buildNotificationRow }

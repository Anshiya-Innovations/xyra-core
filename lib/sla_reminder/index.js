const cds = require('@sap/cds')
const { enumerateActiveTenants } = require('../control_scheduler')
const { listLevel1Queue, listLevel2Queue } = require('../review_engine')
const { getPool, tenantEntities } = require('../tenant/TenantPoolManager')
const { notify } = require('../notification_engine')
const { DEFAULT_SLA_SETTINGS } = require('../review_engine/slaDefaults')

// sla_reminder: a weekly, tenant-wide, in-app "here's your review backlog"
// notification. Same in-process-poller shape as control_scheduler (reuses its
// enumerateActiveTenants() rather than duplicating the master-DB
// Tenants/Provisioning join) - no new cron dependency. Polls hourly, not
// every 60s like control_scheduler: a weekly cadence doesn't need tight
// polling, it just needs to notice "a week has passed" within an hour or so.
//
// No per-role targeting: Notifications has no userId/role column and
// "Reviewer1 vs Reviewer2" is not a stored user attribute anywhere in this
// codebase (see review_engine's own header comment) - this is a tenant-wide
// broadcast, same as every other notify() call in the app.
const POLL_INTERVAL_MS = 60 * 60 * 1000
const REMINDER_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000

async function stampSent(tenantId, databaseName, existingRow) {
  const tenantDb = await getPool(tenantId, databaseName)
  const { SlaSettings } = await tenantEntities()
  const tx = tenantDb.tx()
  try {
    if (existingRow) {
      await tx.run(UPDATE(SlaSettings).set({ lastReminderSentAt: new Date() }).where({ ID: existingRow.ID }))
    } else {
      // Legacy tenant with no row yet (not re-provisioned/seeded) - self-heal
      // so the next tick doesn't re-check from scratch every hour forever.
      await tx.run(INSERT.into(SlaSettings).entries({ ID: cds.utils.uuid(), ...DEFAULT_SLA_SETTINGS, lastReminderSentAt: new Date() }))
    }
  } finally {
    await tx.commit()
  }
}

async function maybeSendReminder(tenantId, databaseName) {
  const tenantDb = await getPool(tenantId, databaseName)
  const { SlaSettings } = await tenantEntities()
  const tx = tenantDb.tx()
  let settings
  try {
    settings = await tx.run(SELECT.one.from(SlaSettings))
  } finally {
    await tx.commit()
  }

  const lastSent = settings && settings.lastReminderSentAt ? new Date(settings.lastReminderSentAt).getTime() : 0
  if (Date.now() - lastSent < REMINDER_INTERVAL_MS) return

  const [level1, level2] = await Promise.all([
    listLevel1Queue(tenantId, databaseName),
    listLevel2Queue(tenantId, databaseName)
  ])
  const allPending = level1.concat(level2)
  const pendingCount = allPending.length
  const overdueCount = allPending.filter((r) => r.isOverdue).length

  if (pendingCount > 0) {
    await notify(tenantId, databaseName, {
      title: 'Weekly Review SLA Reminder',
      message: `${pendingCount} review(s) pending across Level 1/Level 2 queues, ${overdueCount} overdue against your configured SLA.`,
      category: 'REMINDER',
      priority: overdueCount > 0 ? 'HIGH' : 'MEDIUM',
      targetPage: 'Reviewer1',
      icon: 'sap-icon://alert',
      iconClass: overdueCount > 0 ? 'xyraNotifyIconRed' : 'xyraNotifyIconBlue'
    }).catch((err) => console.error('notify(sla_reminder) failed:', err))
  }

  await stampSent(tenantId, databaseName, settings)
}

async function tick() {
  const tenants = await enumerateActiveTenants().catch((err) => {
    console.error('sla_reminder: tenant enumeration failed', err)
    return []
  })
  for (const t of tenants) {
    try {
      await maybeSendReminder(t.tenantId, t.databaseName)
    } catch (err) {
      console.error(`sla_reminder: tick failed for tenant ${t.tenantId}`, err)
    }
  }
}

function start() {
  console.log(`sla_reminder: polling every ${POLL_INTERVAL_MS / 1000}s, sends at most once per ${REMINDER_INTERVAL_MS / 86400000}d per tenant`)
  const timer = setInterval(tick, POLL_INTERVAL_MS)
  timer.unref()
  return timer
}

module.exports = { start, tick, maybeSendReminder }

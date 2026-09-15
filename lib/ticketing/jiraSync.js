const { enumerateActiveTenants } = require('../control_scheduler')
const { getPool, tenantEntities } = require('../tenant/TenantPoolManager')
const { notify } = require('../notification_engine')
const { getIssueStatus } = require('./jira')

// jiraSync: polls every open (ticketSystem='JIRA', not yet ticketResolved)
// remediation ticket for its current Jira status and writes it back onto the
// Review row - same in-process-poller shape as control_scheduler/
// sla_reminder (no webhook: Jira Cloud can't reach a local dev server
// anyway, and this app has no public endpoint to receive one). Once a
// ticket is resolved it's never polled again.
//
// Small per-tenant dataset, sequential lookups per review (AlertItem ->
// Alert -> System -> Organization -> JiraSettings) - same "small dataset,
// fine to do it plainly" reasoning as review_engine's own createRemediationTicket,
// which this mirrors rather than shares (different module, different
// lifecycle - not worth a shared helper for one ~6-line join used twice).
const POLL_INTERVAL_MS = 2 * 60 * 1000

// Explicit mapping wins when the admin has configured it (matches this
// specific board's real status names); falls back to Jira's built-in
// statusCategory when a status doesn't match any configured mapping (or
// none is configured yet) - ticket sync still works before that setup step.
function isResolved(rawStatus, statusCategory, settings) {
  if (settings.statusResolved) return rawStatus === settings.statusResolved
  return statusCategory === 'done'
}

async function syncOneReview(tx, entities, review) {
  const { AlertItems, Alerts, Systems, Controls, JiraSettings } = entities
  const item = await tx.run(SELECT.one.from(AlertItems).where({ ID: review.alertItem_ID }))
  const alert = item ? await tx.run(SELECT.one.from(Alerts).where({ ID: item.alert_ID })) : null
  const system = alert ? await tx.run(SELECT.one.from(Systems).where({ ID: alert.system_ID })) : null
  const control = alert ? await tx.run(SELECT.one.from(Controls).where({ ID: alert.control_ID })) : null

  const settings = system && system.organization_ID
    ? await tx.run(SELECT.one.from(JiraSettings).where({ organization_ID: system.organization_ID }))
    : null
  if (!settings || !settings.enabled) return null

  const result = await getIssueStatus({
    siteUrl: settings.siteUrl, email: settings.email, apiToken: settings.apiToken, issueKey: review.ticketNumber
  }).catch((err) => ({ success: false, message: err.message }))
  if (!result.success) return null

  const resolved = isResolved(result.status, result.statusCategory, settings)
  await tx.run(UPDATE(entities.Reviews).set({
    ticketStatus: result.status, ticketResolved: resolved, ticketStatusUpdatedAt: new Date()
  }).where({ ID: review.ID }))

  return resolved ? { review, control, system } : null
}

async function syncTenant(tenantId, databaseName) {
  const tenantDb = await getPool(tenantId, databaseName)
  const entities = await tenantEntities()
  const tx = tenantDb.tx()
  let justResolved = []
  try {
    const rows = await tx.run(SELECT.from(entities.Reviews).where({ ticketSystem: 'JIRA' }))
    const openTickets = rows.filter((r) => r.ticketNumber && !r.ticketResolved)
    for (const review of openTickets) {
      const resolved = await syncOneReview(tx, entities, review)
      if (resolved) justResolved.push(resolved)
    }
  } finally {
    await tx.commit()
  }

  for (const { review, control, system } of justResolved) {
    notify(tenantId, databaseName, {
      title: 'Remediation ticket resolved',
      message: `Jira ticket ${review.ticketNumber} for ${control ? control.code : 'a control'} on ${system ? system.systemId : 'a system'} was marked resolved.`,
      category: 'TICKET', priority: 'LOW',
      targetPage: review.ticketLevel === 2 ? 'Reviewer2' : 'Reviewer1', targetRecord: review.ID,
      icon: 'sap-icon://accept', iconClass: 'xyraNotifyIconGreen'
    }).catch((err) => console.error('notify(jiraSync) failed:', err))
  }
}

async function tick() {
  const tenants = await enumerateActiveTenants().catch((err) => {
    console.error('jiraSync: tenant enumeration failed', err)
    return []
  })
  for (const t of tenants) {
    try {
      await syncTenant(t.tenantId, t.databaseName)
    } catch (err) {
      console.error(`jiraSync: tick failed for tenant ${t.tenantId}`, err)
    }
  }
}

function start() {
  console.log(`jiraSync: polling every ${POLL_INTERVAL_MS / 1000}s for open Jira ticket status`)
  const timer = setInterval(tick, POLL_INTERVAL_MS)
  timer.unref()
  return timer
}

module.exports = { start, tick }

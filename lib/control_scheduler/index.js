const cds = require('@sap/cds')
const { runDueControls } = require('../control_engine')

// control_scheduler: a single in-process poller, not a separate process or a
// new cron library dependency - same unref'd setInterval pattern
// TenantPoolManager already uses for its own pool sweep. Every tick,
// enumerate active tenants (master DB) and run whatever Controls are due in
// each tenant's own database.

const POLL_INTERVAL_MS = 60 * 1000

// Same Tenants(status=ACTIVE) -> Provisioning(status=COMPLETED, databaseName)
// join lib/tenant/resolveTenant.js already does, just without the Domains hop
// since this isn't resolving a subdomain - it's enumerating every tenant.
// Plain top-level SELECT (no cds.tx(req)) - there's no request here, and
// lib/provisioning/masterUpdate.js already establishes that plain top-level
// queries against the ambient default (master) DB connection work fine
// outside a request context.
async function enumerateActiveTenants() {
  const { Tenants, Provisioning } = cds.entities('xyra.master')
  const tenants = await SELECT.from(Tenants).where({ status: 'ACTIVE' })
  const out = []
  for (const t of tenants) {
    const job = await SELECT.one.from(Provisioning).where({ tenant_ID: t.ID, status: 'COMPLETED' })
    if (job && job.databaseName) out.push({ tenantId: t.ID, databaseName: job.databaseName })
  }
  return out
}

async function tick() {
  const tenants = await enumerateActiveTenants().catch((err) => {
    console.error('control_scheduler: tenant enumeration failed', err)
    return []
  })
  for (const t of tenants) {
    try {
      await runDueControls(t.tenantId, t.databaseName)
    } catch (err) {
      console.error(`control_scheduler: tick failed for tenant ${t.tenantId}`, err)
    }
  }
}

function start() {
  console.log(`control_scheduler: polling every ${POLL_INTERVAL_MS / 1000}s`)
  const timer = setInterval(tick, POLL_INTERVAL_MS)
  timer.unref() // don't keep the process alive just for this
  return timer
}

module.exports = { start, tick, enumerateActiveTenants }

const cds = require('@sap/cds')
const perf = require('../perf/trace')

// tenantId -> { status, databaseName, companyName, adminEmail }, held in process
// memory so an authenticated request never queries the master DB: the auth
// middleware reads this map, nothing else. It's refreshed in the background
// (REFRESH_MS), never on the request path — the only request-time master read
// is a one-off load for a tenantId this process hasn't seen yet (e.g. provisioned
// since the last refresh).
//
// Suspension: setStatus() applies instantly in this process; other instances
// pick it up on their next refresh.
// ponytail: up to REFRESH_MS stale across instances — add a pub/sub
// invalidation only if multi-instance suspension must be instant.

const REFRESH_MS = 60 * 1000
const tenants = new Map()

function toEntry(t, job) {
  return { status: t.status, databaseName: job ? job.databaseName : null, companyName: t.companyName, adminEmail: t.adminEmail }
}

async function refresh() {
  const { Tenants, Provisioning } = cds.entities('xyra.master')
  const [rows, jobs] = await Promise.all([
    SELECT.from(Tenants).columns('ID', 'status', 'companyName', 'adminEmail'),
    SELECT.from(Provisioning).columns('tenant_ID', 'databaseName').where({ status: 'COMPLETED' })
  ])
  const jobOf = new Map(jobs.map((j) => [j.tenant_ID, j]))
  tenants.clear()
  for (const t of rows) tenants.set(t.ID, toEntry(t, jobOf.get(t.ID)))
}

async function loadOne(tenantId) {
  perf.note('tenantDirectoryMiss', true)
  const { Tenants, Provisioning } = cds.entities('xyra.master')
  const [t, job] = await Promise.all([
    SELECT.one.from(Tenants).columns('ID', 'status', 'companyName', 'adminEmail').where({ ID: tenantId }),
    SELECT.one.from(Provisioning).columns('databaseName').where({ tenant_ID: tenantId, status: 'COMPLETED' })
  ])
  if (t) tenants.set(tenantId, toEntry(t, job))
  return tenants.get(tenantId) || null
}

// The tenant, only if it can serve requests right now (ACTIVE + provisioned).
async function activeTenant(tenantId) {
  const t = tenants.get(tenantId) || (await loadOne(tenantId))
  return t && t.status === 'ACTIVE' && t.databaseName ? t : null
}

function setStatus(tenantId, status) {
  const t = tenants.get(tenantId)
  if (t) t.status = status
}

function start() {
  const run = () => refresh().catch((err) => console.error('TenantDirectory refresh failed:', err.message))
  run()
  const timer = setInterval(run, REFRESH_MS)
  timer.unref()
  return timer
}

module.exports = { activeTenant, setStatus, refresh, start }

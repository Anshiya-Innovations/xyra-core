const { getPool, tenantEntities } = require('../../lib/tenant/TenantPoolManager')
const { resolveTenantBySubdomain } = require('../../lib/tenant/resolveTenant')

// Alerts.incidentStatus (NEW/IN_PROCESS/RESOLVED/CLOSED) -> the 3 buckets the
// Deviation Report UI actually has. CLOSED folds into Resolved - there's no
// distinct "Closed" column on that screen.
function toDisplayStatus(incidentStatus) {
  if (incidentStatus === 'IN_PROCESS') return 'In Progress'
  if (incidentStatus === 'RESOLVED' || incidentStatus === 'CLOSED') return 'Resolved'
  return 'Open'
}

// AlertItems/Alerts.severity (CRITICAL/MEDIUM, see control_engine) -> the
// title-cased text the UI renders.
function toDisplaySeverity(severity) {
  if (severity === 'CRITICAL') return 'Critical'
  if (severity === 'MEDIUM') return 'Medium'
  return severity || ''
}

async function loadAlertHeader(tx, Controls, Systems, AlertItems, alert) {
  const control = await tx.run(SELECT.one.from(Controls).where({ ID: alert.control_ID }))
  const system = await tx.run(
    SELECT.one.from(Systems)
      .columns('ID', 'systemId', 'client', 'organization_ID', 'platform.code as platform', 'region.code as region', 'sector.code as sector')
      .where({ ID: alert.system_ID })
  )
  const items = await tx.run(SELECT.from(AlertItems).columns('ID').where({ alert_ID: alert.ID, deviationFlag: true }))

  return {
    id: alert.ID,
    controlId: control ? control.code : '',
    controlDescription: control ? control.description : '',
    systemId: system ? system.systemId : '',
    client: system ? system.client : '',
    organizationId: (system && system.organization_ID) || '',
    sector: (system && system.sector) || '',
    region: (system && system.region) || '',
    platform: (system && system.platform) || '',
    status: toDisplayStatus(alert.incidentStatus),
    severity: toDisplaySeverity(alert.severity),
    deviationCount: items.length,
    alertDate: alert.incidentCreatedAt,
    description: alert.description || ''
  }
}

// Batch version for listDeviations: 3 full-table SELECTs total (same "small
// per-tenant dataset, fetch once" pattern as review_engine.loadLookups) instead
// of 3 awaited queries per Alert row. loadAlertHeader above was originally
// called once per row in a for-loop - a real N+1 that made listDeviations time
// out (15s+) once there were ~19 Alerts against a non-local Postgres instance.
async function loadHeaderLookups(tx, entities) {
  const { Controls, Systems, AlertItems } = entities
  const [controls, systems, items] = await Promise.all([
    tx.run(SELECT.from(Controls)),
    tx.run(SELECT.from(Systems).columns('ID', 'systemId', 'client', 'organization_ID', 'platform.code as platform', 'region.code as region', 'sector.code as sector')),
    tx.run(SELECT.from(AlertItems).columns('ID', 'alert_ID').where({ deviationFlag: true }))
  ])
  const deviationCountByAlert = new Map()
  items.forEach((i) => deviationCountByAlert.set(i.alert_ID, (deviationCountByAlert.get(i.alert_ID) || 0) + 1))
  return {
    controlById: new Map(controls.map((c) => [c.ID, c])),
    systemById: new Map(systems.map((s) => [s.ID, s])),
    deviationCountByAlert
  }
}

function buildAlertHeader(alert, lookups) {
  const control = lookups.controlById.get(alert.control_ID)
  const system = lookups.systemById.get(alert.system_ID)

  return {
    id: alert.ID,
    controlId: control ? control.code : '',
    controlDescription: control ? control.description : '',
    systemId: system ? system.systemId : '',
    client: system ? system.client : '',
    organizationId: (system && system.organization_ID) || '',
    sector: (system && system.sector) || '',
    region: (system && system.region) || '',
    platform: (system && system.platform) || '',
    status: toDisplayStatus(alert.incidentStatus),
    severity: toDisplaySeverity(alert.severity),
    deviationCount: lookups.deviationCountByAlert.get(alert.ID) || 0,
    alertDate: alert.incidentCreatedAt,
    description: alert.description || ''
  }
}

// Filters applied in JS, not SQL - the Deviation Report's filter set spans
// two related entities (Alerts + its Systems/Controls) and a date range;
// building that as a single safe CQN WHERE isn't worth it for what's expected
// to be a small, per-tenant row count. See control_engine's runDueControls for
// the same reasoning.
function matchesFilters(header, f) {
  if (f.organizationId && f.organizationId !== 'All' && header.organizationId !== f.organizationId) return false
  if (f.sector && f.sector !== 'All' && header.sector !== f.sector) return false
  if (f.region && f.region !== 'All' && header.region !== f.region) return false
  if (f.platform && f.platform !== 'All' && header.platform !== f.platform) return false
  if (f.systemId && f.systemId !== 'All' && header.systemId !== f.systemId) return false
  if (f.client && f.client !== 'All' && header.client !== f.client) return false
  if (f.controlId && f.controlId !== 'All' && header.controlId !== f.controlId) return false
  if (f.status && f.status !== 'All' && header.status !== f.status) return false
  if (f.startDate && header.alertDate && new Date(header.alertDate) < new Date(f.startDate)) return false
  if (f.endDate && header.alertDate && new Date(header.alertDate) > new Date(`${f.endDate}T23:59:59`)) return false
  return true
}

module.exports = function (srv) {
  srv.on('listDeviations', async (req) => {
    const fail = (message) => ({ success: false, message, headers: [], kpi: {} })
    const subdomain = (req.data.subdomain || '').trim()
    if (!subdomain) return fail('subdomain is required.')

    const resolved = await resolveTenantBySubdomain(req, subdomain)
    if (!resolved) return fail('Tenant not found.')

    const tenantDb = await getPool(resolved.tenant.ID, resolved.databaseName)
    const entities = await tenantEntities()
    const { Alerts, ControlRunHistory } = entities
    const tx = tenantDb.tx()
    try {
      const alerts = await tx.run(SELECT.from(Alerts).orderBy('incidentCreatedAt desc'))
      const lookups = await loadHeaderLookups(tx, entities)
      const headers = alerts.map((alert) => buildAlertHeader(alert, lookups))
      const filtered = headers.filter((h) => matchesFilters(h, req.data))

      const totalIncidents = filtered.length
      const openItems = filtered.filter((h) => h.status === 'Open').length
      const resolvedItems = filtered.filter((h) => h.status === 'Resolved').length
      const auditedControls = new Set(filtered.map((h) => h.controlId)).size

      // "Compliance rate" = % of individual rule checks (ControlRunHistory rows,
      // deviation or not) that passed, tenant-wide — the most literal reading of
      // the term for a CCM tool; the frontend's own mock just hard-codes "71%".
      const historyRows = await tx.run(SELECT.from(ControlRunHistory).columns('deviationFlag'))
      const complianceRate = historyRows.length
        ? `${Math.round((1 - historyRows.filter((r) => r.deviationFlag).length / historyRows.length) * 100)}%`
        : '100%'

      return {
        success: true,
        message: 'OK',
        headers: filtered,
        kpi: { totalIncidents, openItems, resolvedItems, auditedControls, complianceRate }
      }
    } finally {
      await tx.commit()
    }
  })

  srv.on('getDeviationDetail', async (req) => {
    const fail = (message) => ({ success: false, message, header: null, items: [] })
    const subdomain = (req.data.subdomain || '').trim()
    const alertId = (req.data.alertId || '').trim()
    if (!subdomain || !alertId) return fail('alertId is required.')

    const resolved = await resolveTenantBySubdomain(req, subdomain)
    if (!resolved) return fail('Tenant not found.')

    const tenantDb = await getPool(resolved.tenant.ID, resolved.databaseName)
    const { Alerts, AlertItems, Controls, Systems } = await tenantEntities()
    const tx = tenantDb.tx()
    try {
      const alert = await tx.run(SELECT.one.from(Alerts).where({ ID: alertId }))
      if (!alert) return fail('Alert not found.')

      const header = await loadAlertHeader(tx, Controls, Systems, AlertItems, alert)
      const rows = await tx.run(SELECT.from(AlertItems).where({ alert_ID: alertId }).orderBy('createdAt'))
      const items = rows.map((r) => ({
        id: r.ID,
        sapObject: r.sapObject,
        parameter: r.parameter,
        operator: r.operator,
        expectedValue: r.expectedValue,
        actualValue: r.actualValue,
        status: toDisplaySeverity(r.severity),
        timestamp: r.createdAt,
        message: r.message
      }))

      return { success: true, message: 'OK', header, items }
    } finally {
      await tx.commit()
    }
  })

  srv.on('getRunLogs', async (req) => {
    const fail = (message) => ({ success: false, message, logs: [] })
    const subdomain = (req.data.subdomain || '').trim()
    const alertId = (req.data.alertId || '').trim()
    if (!subdomain || !alertId) return fail('alertId is required.')

    const resolved = await resolveTenantBySubdomain(req, subdomain)
    if (!resolved) return fail('Tenant not found.')

    const tenantDb = await getPool(resolved.tenant.ID, resolved.databaseName)
    const { ControlRunLogs } = await tenantEntities()
    const tx = tenantDb.tx()
    try {
      const rows = await tx.run(SELECT.from(ControlRunLogs).where({ alert_ID: alertId }).orderBy('createdAt'))
      return { success: true, message: 'OK', logs: rows.map((r) => ({ id: r.ID, level: r.level, message: r.message, timestamp: r.createdAt })) }
    } finally {
      await tx.commit()
    }
  })

  srv.on('getControlLogs', async (req) => {
    const fail = (message) => ({ success: false, message, logs: [] })
    const subdomain = (req.data.subdomain || '').trim()
    const controlId = (req.data.controlId || '').trim()
    if (!subdomain || !controlId) return fail('controlId is required.')

    const resolved = await resolveTenantBySubdomain(req, subdomain)
    if (!resolved) return fail('Tenant not found.')

    const tenantDb = await getPool(resolved.tenant.ID, resolved.databaseName)
    const { Controls, ControlRunLogs } = await tenantEntities()
    const tx = tenantDb.tx()
    try {
      const control = await tx.run(SELECT.one.from(Controls).where({ code: controlId }))
      if (!control) return fail('Control not found.')

      const limit = req.data.limit && req.data.limit > 0 ? req.data.limit : 50
      const rows = await tx.run(SELECT.from(ControlRunLogs).where({ control_ID: control.ID }).orderBy('createdAt desc').limit(limit))
      return { success: true, message: 'OK', logs: rows.map((r) => ({ id: r.ID, level: r.level, message: r.message, timestamp: r.createdAt })) }
    } finally {
      await tx.commit()
    }
  })
}

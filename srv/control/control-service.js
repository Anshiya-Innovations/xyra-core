const cds = require('@sap/cds')
const { getPool, tenantEntities } = require('../../lib/tenant/TenantPoolManager')
const { resolveTenantBySubdomain } = require('../../lib/tenant/resolveTenant')
const { runControl } = require('../../lib/control_engine')
const { logAudit } = require('../../lib/audit')

function toRuleEntry(r) {
  return {
    id: r.ID, sortOrder: r.sortOrder, sapObject: r.sapObject,
    parameterType: r.parameterType, parameter: r.parameter, operator: r.operator, expectedValue: r.expectedValue
  }
}

async function loadControlEntry(tx, ControlRules, ControlSystemConfig, control) {
  const rules = await tx.run(SELECT.from(ControlRules).where({ control_ID: control.ID }).orderBy('sortOrder'))
  const configs = await tx.run(SELECT.from(ControlSystemConfig).columns('system_ID').where({ control_ID: control.ID }))
  return buildControlEntry(control, {
    rulesByControl: new Map([[control.ID, rules]]),
    systemIdsByControl: new Map([[control.ID, configs.map((c) => c.system_ID)]])
  })
}

// Batch version for listControls: 2 full-table SELECTs total (same "small
// per-tenant dataset, fetch once" pattern already proven in
// deviation-service.js's loadHeaderLookups and review_engine's loadLookups)
// instead of loadControlEntry's 2 awaited queries per control row - that
// exact N+1 shape already made listDeviations/review queues take 15-30s+
// before those got the same treatment; control-service.js was the one place
// still doing it the slow way.
async function loadControlLookups(tx, ControlRules, ControlSystemConfig) {
  const [rules, configs] = await Promise.all([
    tx.run(SELECT.from(ControlRules).orderBy('sortOrder')),
    tx.run(SELECT.from(ControlSystemConfig).columns('control_ID', 'system_ID'))
  ])
  const rulesByControl = new Map()
  rules.forEach((r) => {
    if (!rulesByControl.has(r.control_ID)) rulesByControl.set(r.control_ID, [])
    rulesByControl.get(r.control_ID).push(r)
  })
  const systemIdsByControl = new Map()
  configs.forEach((c) => {
    if (!systemIdsByControl.has(c.control_ID)) systemIdsByControl.set(c.control_ID, [])
    systemIdsByControl.get(c.control_ID).push(c.system_ID)
  })
  return { rulesByControl, systemIdsByControl }
}

function buildControlEntry(control, lookups) {
  return {
    id: control.ID,
    code: control.code,
    description: control.description,
    category: control.category || '',
    controlType: control.controlType,
    severity: control.severity || 'MEDIUM',
    frequency: control.frequency,
    cronExpression: control.cronExpression || '',
    enabled: control.enabled,
    systemIds: lookups.systemIdsByControl.get(control.ID) || [],
    lastRunAt: control.lastRunAt,
    lastRunStatus: control.lastRunStatus || '',
    nextRunAt: control.nextRunAt,
    rules: (lookups.rulesByControl.get(control.ID) || []).map(toRuleEntry),
    createdAt: control.createdAt,
    createdBy: control.createdBy,
    modifiedAt: control.modifiedAt,
    modifiedBy: control.modifiedBy
  }
}

// Full replace on every save — simplest correct approach given ControlRules
// has no identity worth preserving across an edit (AlertItems/ControlRunHistory
// snapshot their own sapObject/parameter/operator, so they're unaffected by
// this - see db/tenant/alerts.cds). System mapping (ControlSystemConfig) is
// owned by SystemControlConfigService now, not touched here.
async function replaceRules(tx, ControlRules, controlId, rules) {
  await tx.run(DELETE.from(ControlRules).where({ control_ID: controlId }))
  if (rules && rules.length) {
    const ruleEntries = rules.map((rule, i) => ({
      ID: cds.utils.uuid(),
      control_ID: controlId,
      sortOrder: rule.sortOrder || i + 1,
      sapObject: rule.sapObject,
      parameterType: rule.parameterType || 'GENERAL',
      parameter: rule.parameter,
      operator: rule.operator,
      expectedValue: rule.expectedValue
    }))
    await tx.run(INSERT.into(ControlRules).entries(ruleEntries))
  }
}

const VALID_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH']
function normalizeSeverity(severity) {
  return VALID_SEVERITIES.includes(severity) ? severity : 'MEDIUM'
}

module.exports = function (srv) {
  srv.on('listControls', async (req) => {
    const fail = (message) => ({ success: false, message, controls: [] })
    const subdomain = (req.data.subdomain || '').trim()
    if (!subdomain) return fail('subdomain is required.')

    const resolved = await resolveTenantBySubdomain(req, subdomain)
    if (!resolved) return fail('Tenant not found.')

    const tenantDb = await getPool(resolved.tenant.ID, resolved.databaseName)
    const { Controls, ControlRules, ControlSystemConfig } = await tenantEntities()
    const tx = tenantDb.tx()
    try {
      // loadControlLookups fetches ALL rules/configs tenant-wide, independent
      // of which Controls rows come back - no reason to wait for Controls
      // before starting it too (each round trip to this DB costs real time -
      // see resolveTenant.js's cache comment - so overlapping what can be
      // overlapped still matters even though this driver serializes queries
      // on one connection rather than truly pipelining them).
      const [controls, lookups] = await Promise.all([
        tx.run(SELECT.from(Controls).orderBy('createdAt desc')),
        loadControlLookups(tx, ControlRules, ControlSystemConfig)
      ])
      const entries = controls.map((control) => buildControlEntry(control, lookups))
      return { success: true, message: 'OK', controls: entries }
    } finally {
      await tx.commit()
    }
  })

  srv.on('getControl', async (req) => {
    const fail = (message) => ({ success: false, message, control: null })
    const subdomain = (req.data.subdomain || '').trim()
    const id = (req.data.id || '').trim()
    if (!subdomain || !id) return fail('id is required.')

    const resolved = await resolveTenantBySubdomain(req, subdomain)
    if (!resolved) return fail('Tenant not found.')

    const tenantDb = await getPool(resolved.tenant.ID, resolved.databaseName)
    const { Controls, ControlRules, ControlSystemConfig } = await tenantEntities()
    const tx = tenantDb.tx()
    try {
      const control = await tx.run(SELECT.one.from(Controls).where({ ID: id }))
      if (!control) return fail('Control not found.')
      return { success: true, message: 'OK', control: await loadControlEntry(tx, ControlRules, ControlSystemConfig, control) }
    } finally {
      await tx.commit()
    }
  })

  srv.on('createControl', async (req) => {
    const fail = (message) => ({ success: false, message })
    const subdomain = (req.data.subdomain || '').trim()
    const code = (req.data.code || '').trim()
    const description = (req.data.description || '').trim()
    if (!subdomain || !code || !description) return fail('Control ID and Description are required.')

    const resolved = await resolveTenantBySubdomain(req, subdomain)
    if (!resolved) return fail('Tenant not found.')

    const tenantDb = await getPool(resolved.tenant.ID, resolved.databaseName)
    const entities = await tenantEntities()
    const { Controls, ControlRules } = entities
    const tx = tenantDb.tx()
    try {
      const existing = await tx.run(SELECT.one.from(Controls).where({ code }))
      if (existing) return fail(`Control ${code} already exists.`)

      const id = cds.utils.uuid()
      await tx.run(INSERT.into(Controls).entries({
        ID: id,
        code,
        description,
        category: req.data.category || null,
        controlType: req.data.controlType || 'SECURITY',
        severity: normalizeSeverity(req.data.severity),
        frequency: req.data.frequency || 'DAILY',
        cronExpression: req.data.cronExpression || null,
        enabled: true
      }))
      await replaceRules(tx, ControlRules, id, req.data.rules)

      await logAudit(tx, entities, {
        action: 'CONTROL_CREATE',
        module: 'Control Management',
        objectType: 'Control',
        objectId: code,
        objectLabel: code,
        description: `Created Security Control Master rule '${code}': ${description}`,
        controlId: code,
        performedBy: req.data.performedBy,
        performedByRole: req.data.performedByRole
      })

      return { success: true, message: 'Control created.', id }
    } finally {
      await tx.commit()
    }
  })

  srv.on('updateControl', async (req) => {
    const fail = (message) => ({ success: false, message })
    const subdomain = (req.data.subdomain || '').trim()
    const id = (req.data.id || '').trim()
    if (!subdomain || !id) return fail('id is required.')

    const resolved = await resolveTenantBySubdomain(req, subdomain)
    if (!resolved) return fail('Tenant not found.')

    const tenantDb = await getPool(resolved.tenant.ID, resolved.databaseName)
    const entities = await tenantEntities()
    const { Controls, ControlRules } = entities
    const tx = tenantDb.tx()
    try {
      const existing = await tx.run(SELECT.one.from(Controls).where({ ID: id }))
      if (!existing) return fail('Control not found.')

      const sNewDesc = req.data.description || existing.description
      const sNewFreq = req.data.frequency || existing.frequency

      await tx.run(UPDATE(Controls).set({
        description: sNewDesc,
        category: req.data.category || null,
        controlType: req.data.controlType || existing.controlType,
        severity: normalizeSeverity(req.data.severity || existing.severity),
        frequency: sNewFreq,
        cronExpression: req.data.cronExpression || null,
        enabled: req.data.enabled === undefined ? existing.enabled : !!req.data.enabled
      }).where({ ID: id }))
      await replaceRules(tx, ControlRules, id, req.data.rules)

      await logAudit(tx, entities, {
        action: 'CONTROL_UPDATE',
        module: 'Control Management',
        objectType: 'Control',
        objectId: existing.code,
        objectLabel: existing.code,
        description: `Updated Security Control Master rule '${existing.code}'.`,
        previousValue: `Desc: ${existing.description} | Freq: ${existing.frequency}`,
        newValue: `Desc: ${sNewDesc} | Freq: ${sNewFreq}`,
        controlId: existing.code,
        performedBy: req.data.performedBy,
        performedByRole: req.data.performedByRole
      })

      return { success: true, message: 'Control updated.' }
    } finally {
      await tx.commit()
    }
  })

  srv.on('deleteControl', async (req) => {
    const fail = (message) => ({ success: false, message })
    const subdomain = (req.data.subdomain || '').trim()
    const id = (req.data.id || '').trim()
    if (!subdomain || !id) return fail('id is required.')

    const resolved = await resolveTenantBySubdomain(req, subdomain)
    if (!resolved) return fail('Tenant not found.')

    const tenantDb = await getPool(resolved.tenant.ID, resolved.databaseName)
    const entities = await tenantEntities()
    const { Controls, ControlRules, ControlSystemConfig } = entities
    const tx = tenantDb.tx()
    try {
      const existing = await tx.run(SELECT.one.from(Controls).where({ ID: id }))
      if (!existing) return fail('Control not found.')

      // Deletes only the Control's own definition rows (rules/system config) —
      // Alerts/AlertItems/ControlRunHistory/ControlRunLogs are compliance
      // history and deliberately survive a Control's deletion.
      await tx.run(DELETE.from(ControlRules).where({ control_ID: id }))
      await tx.run(DELETE.from(ControlSystemConfig).where({ control_ID: id }))
      await tx.run(DELETE.from(Controls).where({ ID: id }))

      await logAudit(tx, entities, {
        action: 'CONTROL_DELETE',
        module: 'Control Management',
        objectType: 'Control',
        objectId: existing.code,
        objectLabel: existing.code,
        description: `Deleted Security Control Master rule '${existing.code}': ${existing.description}`,
        controlId: existing.code,
        performedBy: req.data.performedBy,
        performedByRole: req.data.performedByRole
      })

      return { success: true, message: 'Control deleted.' }
    } finally {
      await tx.commit()
    }
  })

  srv.on('runControlNow', async (req) => {
    const fail = (message) => ({ success: false, message, deviationsFound: null, alertsCreated: null })
    const subdomain = (req.data.subdomain || '').trim()
    const id = (req.data.id || '').trim()
    if (!subdomain || !id) return fail('id is required.')

    const resolved = await resolveTenantBySubdomain(req, subdomain)
    if (!resolved) return fail('Tenant not found.')

    const result = await runControl(resolved.tenant.ID, resolved.databaseName, id)

    // runControl manages its own tx internally and doesn't expose one to
    // piggyback on - open a small separate one just for the audit row, after
    // the real run already succeeded.
    if (result && result.success) {
      const tenantDb = await getPool(resolved.tenant.ID, resolved.databaseName)
      const entities = await tenantEntities()
      const tx = tenantDb.tx()
      try {
        const control = await tx.run(SELECT.one.from(entities.Controls).where({ ID: id }))
        const code = control ? control.code : id
        await logAudit(tx, entities, {
          action: 'CONTROL_RUN',
          module: 'Control Management',
          objectType: 'Control',
          objectId: code,
          objectLabel: code,
          description: `Ran Security Control Master rule '${code}' now: ${result.systemsChecked} system(s) checked, ${result.deviationsFound} deviation(s) found, ${result.alertsCreated} alert(s) created.`,
          controlId: code,
          performedBy: req.data.performedBy,
          performedByRole: req.data.performedByRole
        })
      } finally {
        await tx.commit()
      }
    }

    return result
  })

  srv.on('listControlHistory', async (req) => {
    const fail = (message) => ({ success: false, message, history: [] })
    const subdomain = (req.data.subdomain || '').trim()
    const controlId = (req.data.controlId || '').trim()
    if (!subdomain || !controlId) return fail('Please select a Control.')

    const resolved = await resolveTenantBySubdomain(req, subdomain)
    if (!resolved) return fail('Tenant not found.')

    const tenantDb = await getPool(resolved.tenant.ID, resolved.databaseName)
    const { Controls, Systems, ControlRunHistory } = await tenantEntities()
    const tx = tenantDb.tx()
    try {
      const control = await tx.run(SELECT.one.from(Controls).where({ ID: controlId }))
      if (!control) return fail('Control not found.')

      // Control is a mandatory filter, pushed down as a real WHERE - this
      // table grows one row per (control x system x rule) every run, forever,
      // so "fetch everything then filter in JS" (the pattern used elsewhere
      // in this codebase for small datasets) isn't safe here.
      const rows = await tx.run(
        SELECT.from(ControlRunHistory).where({ control_ID: controlId }).orderBy('createdAt desc').limit(2000)
      )
      const systems = await tx.run(
        SELECT.from(Systems).columns('ID', 'systemId', 'client', 'platform.code as platform', 'region.code as region', 'sector.code as sector')
      )
      const systemById = new Map(systems.map((s) => [s.ID, s]))

      const startMs = req.data.startDate ? new Date(req.data.startDate).getTime() : null
      const endMs = req.data.endDate ? new Date(`${req.data.endDate}T23:59:59`).getTime() : null

      const entries = rows
        .map((r) => {
          const sys = systemById.get(r.system_ID) || {}
          return {
            controlId: control.code, controlDescription: control.description,
            systemId: sys.systemId || '', client: sys.client || '',
            region: sys.region || '', platform: sys.platform || '', sector: sys.sector || '',
            sapObject: r.sapObject, parameter: r.parameter, operator: r.operator,
            actualValue: r.actualValue || '', expectedValue: r.expectedValue || '',
            deviationFlag: !!r.deviationFlag, message: r.message || '',
            capturedAt: r.createdAt
          }
        })
        .filter((e) =>
          (!req.data.systemId || e.systemId === req.data.systemId) &&
          (!req.data.client || e.client === req.data.client) &&
          (!req.data.region || e.region === req.data.region) &&
          (!req.data.platform || e.platform === req.data.platform) &&
          (!req.data.sector || e.sector === req.data.sector) &&
          (!startMs || new Date(e.capturedAt).getTime() >= startMs) &&
          (!endMs || new Date(e.capturedAt).getTime() <= endMs)
        )

      return { success: true, message: 'OK', history: entries }
    } finally {
      await tx.commit()
    }
  })
}

const cds = require('@sap/cds')
const { getPool, tenantEntities } = require('../../lib/tenant/TenantPoolManager')
const { resolveTenantBySubdomain } = require('../../lib/tenant/resolveTenant')
const { runControl } = require('../../lib/control_engine')

function toRuleEntry(r) {
  return {
    id: r.ID, sortOrder: r.sortOrder, sapObject: r.sapObject, client: r.client,
    parameterType: r.parameterType, parameter: r.parameter, operator: r.operator, expectedValue: r.expectedValue
  }
}

async function loadControlEntry(tx, ControlRules, ControlSystemConfig, control) {
  const rules = await tx.run(SELECT.from(ControlRules).where({ control_ID: control.ID }).orderBy('sortOrder'))
  const configs = await tx.run(SELECT.from(ControlSystemConfig).columns('system_ID').where({ control_ID: control.ID }))
  return {
    id: control.ID,
    code: control.code,
    description: control.description,
    category: control.category || '',
    controlType: control.controlType,
    frequency: control.frequency,
    cronExpression: control.cronExpression || '',
    critical: control.critical,
    enabled: control.enabled,
    systemIds: configs.map((c) => c.system_ID),
    lastRunAt: control.lastRunAt,
    lastRunStatus: control.lastRunStatus || '',
    nextRunAt: control.nextRunAt,
    rules: rules.map(toRuleEntry),
    createdAt: control.createdAt,
    createdBy: control.createdBy,
    modifiedAt: control.modifiedAt,
    modifiedBy: control.modifiedBy
  }
}

// Full replace on every save — simplest correct approach given ControlRules
// has no identity worth preserving across an edit (AlertItems/ControlRunHistory
// snapshot their own sapObject/parameter/operator, so they're unaffected by
// this - see db/tenant/alerts.cds).
async function replaceRulesAndSystems(tx, ControlRules, ControlSystemConfig, controlId, rules, systemIds) {
  await tx.run(DELETE.from(ControlRules).where({ control_ID: controlId }))
  let sortOrder = 1
  for (const rule of rules || []) {
    await tx.run(INSERT.into(ControlRules).entries({
      ID: cds.utils.uuid(),
      control_ID: controlId,
      sortOrder: rule.sortOrder || sortOrder,
      sapObject: rule.sapObject,
      client: rule.client,
      parameterType: rule.parameterType || 'GENERAL',
      parameter: rule.parameter,
      operator: rule.operator,
      expectedValue: rule.expectedValue
    }))
    sortOrder++
  }

  await tx.run(DELETE.from(ControlSystemConfig).where({ control_ID: controlId }))
  for (const systemId of systemIds || []) {
    await tx.run(INSERT.into(ControlSystemConfig).entries({
      ID: cds.utils.uuid(), control_ID: controlId, system_ID: systemId, enabled: true
    }))
  }
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
      const controls = await tx.run(SELECT.from(Controls).orderBy('createdAt desc'))
      const entries = []
      for (const control of controls) {
        entries.push(await loadControlEntry(tx, ControlRules, ControlSystemConfig, control))
      }
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
    const { Controls, ControlRules, ControlSystemConfig } = await tenantEntities()
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
        frequency: req.data.frequency || 'DAILY',
        cronExpression: req.data.cronExpression || null,
        critical: !!req.data.critical,
        enabled: true
      }))
      await replaceRulesAndSystems(tx, ControlRules, ControlSystemConfig, id, req.data.rules, req.data.systemIds)

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
    const { Controls, ControlRules, ControlSystemConfig } = await tenantEntities()
    const tx = tenantDb.tx()
    try {
      const existing = await tx.run(SELECT.one.from(Controls).where({ ID: id }))
      if (!existing) return fail('Control not found.')

      await tx.run(UPDATE(Controls).set({
        description: req.data.description || existing.description,
        category: req.data.category || null,
        controlType: req.data.controlType || existing.controlType,
        frequency: req.data.frequency || existing.frequency,
        cronExpression: req.data.cronExpression || null,
        critical: !!req.data.critical,
        enabled: req.data.enabled === undefined ? existing.enabled : !!req.data.enabled
      }).where({ ID: id }))
      await replaceRulesAndSystems(tx, ControlRules, ControlSystemConfig, id, req.data.rules, req.data.systemIds)

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
    const { Controls, ControlRules, ControlSystemConfig } = await tenantEntities()
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

    return runControl(resolved.tenant.ID, resolved.databaseName, id)
  })
}

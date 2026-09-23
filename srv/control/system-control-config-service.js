const cds = require('@sap/cds')
const { getPool, tenantEntities } = require('../../lib/tenant/TenantPoolManager')
const { resolveTenantBySubdomain } = require('../../lib/tenant/resolveTenant')
const { logAudit } = require('../../lib/audit')
const { runControl } = require('../../lib/control_engine')

function buildEntry(config, control, system) {
  return {
    id: config.ID,
    controlId: config.control_ID,
    controlCode: control ? control.code : '',
    controlDescription: control ? control.description : '',
    controlSeverity: (control && control.severity) || 'MEDIUM',
    controlType: control ? control.controlType : '',
    controlFrequency: control ? control.frequency : '',
    systemId: config.system_ID,
    systemCode: system ? system.systemId : '',
    systemClient: system ? system.client : '',
    enabled: config.enabled,
    createdAt: config.createdAt,
    deactivatedAt: config.deactivatedAt || null,
    runCount: config.runCount || 0,
    lastRunAt: config.lastRunAt || null,
    lastRunStatus: config.lastRunStatus || ''
  }
}

// Small per-tenant datasets (same "fetch once, join in JS" pattern as
// control-service.js's loadControlLookups / deviation-service.js) — this
// list is never going to be the thing that needs a real join.
async function loadJoined(tx, entities) {
  const { ControlSystemConfig, Controls, Systems } = entities
  const [configs, controls, systems] = await Promise.all([
    tx.run(SELECT.from(ControlSystemConfig).orderBy('createdAt desc')),
    tx.run(SELECT.from(Controls)),
    tx.run(SELECT.from(Systems))
  ])
  const controlById = new Map(controls.map((c) => [c.ID, c]))
  const systemById = new Map(systems.map((s) => [s.ID, s]))
  return configs.map((config) => buildEntry(config, controlById.get(config.control_ID), systemById.get(config.system_ID)))
}

module.exports = function (srv) {
  srv.on('listSystemControlConfigs', async (req) => {
    const fail = (message) => ({ success: false, message, configs: [] })
    const subdomain = (req.data.subdomain || '').trim()
    if (!subdomain) return fail('subdomain is required.')

    const resolved = await resolveTenantBySubdomain(req, subdomain)
    if (!resolved) return fail('Tenant not found.')

    const tenantDb = await getPool(resolved.tenant.ID, resolved.databaseName)
    const entities = await tenantEntities()
    const tx = tenantDb.tx()
    try {
      return { success: true, message: 'OK', configs: await loadJoined(tx, entities) }
    } finally {
      await tx.commit()
    }
  })

  srv.on('listMappableControlsAndSystems', async (req) => {
    const fail = (message) => ({ success: false, message, controls: [], systems: [] })
    const subdomain = (req.data.subdomain || '').trim()
    if (!subdomain) return fail('subdomain is required.')

    const resolved = await resolveTenantBySubdomain(req, subdomain)
    if (!resolved) return fail('Tenant not found.')

    const tenantDb = await getPool(resolved.tenant.ID, resolved.databaseName)
    const { Controls, Systems } = await tenantEntities()
    const tx = tenantDb.tx()
    try {
      const [controls, systems] = await Promise.all([
        tx.run(SELECT.from(Controls).orderBy('code')),
        tx.run(SELECT.from(Systems).orderBy('systemId'))
      ])
      return {
        success: true,
        message: 'OK',
        controls: controls.map((c) => ({
          id: c.ID, code: c.code, description: c.description,
          severity: c.severity || 'MEDIUM', controlType: c.controlType, frequency: c.frequency
        })),
        systems: systems.map((s) => ({ id: s.ID, sysId: s.systemId, client: s.client }))
      }
    } finally {
      await tx.commit()
    }
  })

  srv.on('createSystemControlConfig', async (req) => {
    const fail = (message) => ({ success: false, message, id: null })
    const subdomain = (req.data.subdomain || '').trim()
    const controlId = (req.data.controlId || '').trim()
    const systemId = (req.data.systemId || '').trim()
    if (!subdomain || !controlId || !systemId) return fail('Control and System are required.')

    const resolved = await resolveTenantBySubdomain(req, subdomain)
    if (!resolved) return fail('Tenant not found.')

    const tenantDb = await getPool(resolved.tenant.ID, resolved.databaseName)
    const entities = await tenantEntities()
    const { Controls, Systems, ControlSystemConfig } = entities
    const tx = tenantDb.tx()
    try {
      const control = await tx.run(SELECT.one.from(Controls).where({ ID: controlId }))
      if (!control) return fail('Control not found.')
      const system = await tx.run(SELECT.one.from(Systems).where({ ID: systemId }))
      if (!system) return fail('System not found.')

      const existing = await tx.run(SELECT.one.from(ControlSystemConfig).where({ control_ID: controlId, system_ID: systemId }))
      if (existing) return fail(`Control ${control.code} is already mapped to system ${system.systemId}.`)

      const id = cds.utils.uuid()
      await tx.run(INSERT.into(ControlSystemConfig).entries({
        ID: id, control_ID: controlId, system_ID: systemId, enabled: true, runCount: 0
      }))

      await logAudit(tx, entities, {
        action: 'SYSTEM_CONTROL_CONFIG_CREATE',
        module: 'System Control Config',
        objectType: 'ControlSystemConfig',
        objectId: id,
        objectLabel: `${control.code} -> ${system.systemId}`,
        description: `Mapped control '${control.code}' to run on system '${system.systemId}/${system.client}'.`,
        controlId: control.code,
        systemId: system.systemId,
        performedBy: req.data.performedBy,
        performedByRole: req.data.performedByRole
      })

      return { success: true, message: 'System Control Config created.', id }
    } finally {
      await tx.commit()
    }
  })

  srv.on('setSystemControlConfigStatus', async (req) => {
    const fail = (message) => ({ success: false, message })
    const subdomain = (req.data.subdomain || '').trim()
    const id = (req.data.id || '').trim()
    if (!subdomain || !id) return fail('id is required.')

    const resolved = await resolveTenantBySubdomain(req, subdomain)
    if (!resolved) return fail('Tenant not found.')

    const tenantDb = await getPool(resolved.tenant.ID, resolved.databaseName)
    const entities = await tenantEntities()
    const { Controls, Systems, ControlSystemConfig } = entities
    const tx = tenantDb.tx()
    try {
      const existing = await tx.run(SELECT.one.from(ControlSystemConfig).where({ ID: id }))
      if (!existing) return fail('System Control Config not found.')

      const enabled = !!req.data.enabled
      await tx.run(UPDATE(ControlSystemConfig).set({
        enabled,
        deactivatedAt: enabled ? null : new Date()
      }).where({ ID: id }))

      const control = await tx.run(SELECT.one.from(Controls).where({ ID: existing.control_ID }))
      const system = await tx.run(SELECT.one.from(Systems).where({ ID: existing.system_ID }))
      await logAudit(tx, entities, {
        action: enabled ? 'SYSTEM_CONTROL_CONFIG_ACTIVATE' : 'SYSTEM_CONTROL_CONFIG_DEACTIVATE',
        module: 'System Control Config',
        objectType: 'ControlSystemConfig',
        objectId: id,
        objectLabel: `${control ? control.code : existing.control_ID} -> ${system ? system.systemId : existing.system_ID}`,
        description: `${enabled ? 'Activated' : 'Deactivated'} control '${control ? control.code : existing.control_ID}' on system '${system ? system.systemId : existing.system_ID}'.`,
        controlId: control ? control.code : null,
        systemId: system ? system.systemId : null,
        performedBy: req.data.performedBy,
        performedByRole: req.data.performedByRole
      })

      return { success: true, message: `System Control Config ${enabled ? 'activated' : 'deactivated'}.` }
    } finally {
      await tx.commit()
    }
  })

  srv.on('runSystemControlConfigNow', async (req) => {
    const fail = (message) => ({ success: false, message, deviationsFound: null, alertsCreated: null })
    const subdomain = (req.data.subdomain || '').trim()
    const id = (req.data.id || '').trim()
    if (!subdomain || !id) return fail('id is required.')

    const resolved = await resolveTenantBySubdomain(req, subdomain)
    if (!resolved) return fail('Tenant not found.')

    const tenantDb = await getPool(resolved.tenant.ID, resolved.databaseName)
    const entities = await tenantEntities()
    const { ControlSystemConfig } = entities
    const tx = tenantDb.tx()
    let config
    try {
      config = await tx.run(SELECT.one.from(ControlSystemConfig).where({ ID: id }))
    } finally {
      await tx.commit()
    }
    if (!config) return fail('System Control Config not found.')

    const result = await runControl(resolved.tenant.ID, resolved.databaseName, config.control_ID, config.system_ID)

    // runControl manages its own tx internally and doesn't expose one to
    // piggyback on - open a small separate one just for the audit row, after
    // the real run already succeeded. Same pattern as control-service.js's
    // runControlNow.
    if (result && result.success) {
      const auditTx = tenantDb.tx()
      try {
        const { Controls, Systems } = entities
        const control = await auditTx.run(SELECT.one.from(Controls).where({ ID: config.control_ID }))
        const system = await auditTx.run(SELECT.one.from(Systems).where({ ID: config.system_ID }))
        const code = control ? control.code : config.control_ID
        const sysId = system ? system.systemId : config.system_ID
        await logAudit(auditTx, entities, {
          action: 'SYSTEM_CONTROL_CONFIG_RUN',
          module: 'System Control Config',
          objectType: 'ControlSystemConfig',
          objectId: id,
          objectLabel: `${code} -> ${sysId}`,
          description: `Ran control '${code}' now on system '${sysId}': ${result.deviationsFound} deviation(s) found, ${result.alertsCreated} alert(s) created.`,
          controlId: code,
          systemId: sysId,
          performedBy: req.data.performedBy,
          performedByRole: req.data.performedByRole
        })
      } finally {
        await auditTx.commit()
      }
    }

    return result
  })

  srv.on('getSystemControlConfigDetail', async (req) => {
    const fail = (message) => ({ success: false, message, detail: null, logs: [] })
    const subdomain = (req.data.subdomain || '').trim()
    const id = (req.data.id || '').trim()
    if (!subdomain || !id) return fail('id is required.')

    const resolved = await resolveTenantBySubdomain(req, subdomain)
    if (!resolved) return fail('Tenant not found.')

    const tenantDb = await getPool(resolved.tenant.ID, resolved.databaseName)
    const entities = await tenantEntities()
    const { Controls, Systems, ControlSystemConfig, ControlRunLogs } = entities
    const tx = tenantDb.tx()
    try {
      const config = await tx.run(SELECT.one.from(ControlSystemConfig).where({ ID: id }))
      if (!config) return fail('System Control Config not found.')

      const control = await tx.run(SELECT.one.from(Controls).where({ ID: config.control_ID }))
      const system = await tx.run(SELECT.one.from(Systems).where({ ID: config.system_ID }))

      const logRows = await tx.run(
        SELECT.from(ControlRunLogs)
          .where({ control_ID: config.control_ID, system_ID: config.system_ID })
          .orderBy('createdAt desc')
          .limit(200)
      )

      return {
        success: true,
        message: 'OK',
        detail: buildEntry(config, control, system),
        logs: logRows.map((l) => ({ timestamp: l.createdAt, level: l.level, message: l.message }))
      }
    } finally {
      await tx.commit()
    }
  })
}

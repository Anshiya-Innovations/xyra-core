const cds = require('@sap/cds')
const { getPool, tenantEntities } = require('../../lib/tenant/TenantPoolManager')
const { testConnection } = require('../../lib/connection_engine')
const { notify } = require('../../lib/notification_engine')
const { logAudit } = require('../../lib/audit')
const { deleteSystemCascade } = require('../../lib/admin/cascadeDelete')
const { DEFAULT_SLA_SETTINGS } = require('../../lib/review_engine/slaDefaults')

const SLA_FIELDS = ['reviewer1Days', 'reviewer2Days', 'escalationDelayDays']

// Inserts/updates the one SystemCredentials row for a system. Only touches
// fields that were actually sent — createSystem always writes (even if
// empty, there's nothing to preserve yet), updateSystem only writes non-empty
// ones so leaving the fields blank in the edit dialog keeps what's on file.
async function upsertCredentials(tx, SystemCredentials, systemId, userId, password, { onlyIfProvided } = {}) {
  if (onlyIfProvided && !userId && !password) return
  const existing = await tx.run(SELECT.one.from(SystemCredentials).where({ system_ID: systemId }))
  const patch = {}
  if (userId) patch.userId = userId
  if (password) patch.passwordHash = password
  if (existing) {
    if (Object.keys(patch).length) await tx.run(UPDATE(SystemCredentials).set(patch).where({ ID: existing.ID }))
  } else {
    await tx.run(INSERT.into(SystemCredentials).entries({ ID: cds.utils.uuid(), system_ID: systemId, ...patch }))
  }
}

// The Add/Edit System dialog captures Region/Platform/Sector as one free-text
// field, not a code+description pair — the typed text becomes both, and a
// second system reusing the same text (e.g. two systems both "North America")
// resolves to the same reference row instead of creating a duplicate.
async function resolveRefId(tx, Entity, rawValue) {
  const value = (rawValue || '').trim()
  if (!value) return null
  const existing = await tx.run(SELECT.one.from(Entity).where({ code: value }))
  if (existing) return existing.ID
  const id = cds.utils.uuid()
  await tx.run(INSERT.into(Entity).entries({ ID: id, code: value, description: value }))
  return id
}

// SystemTier enum ('PRODUCTION') <-> the UI's Select values ('Production').
function titleCase(s) {
  if (!s) return ''
  return s.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

module.exports = function (srv) {
  srv.on('listSystems', async (req) => {
    const fail = (message) => ({ success: false, message, systems: [] })

    const { tenantId, databaseName } = req.user.attr

    const tenantDb = await getPool(tenantId, databaseName)
    const { Systems } = await tenantEntities()

    const tx = tenantDb.tx()
    try {
      const rows = await tx.run(
        SELECT.from(Systems)
          .columns(
            'ID', 'systemId', 'client', 'tier', 'hostName', 'systemCompName',
            'clientType', 'version', 'logonGroup', 'port', 'instanceNo', 'status', 'endpoint',
            'lastConnectionStatus', 'organization_ID', 'organization.orgCode as organizationCode', 'organization.name as organizationName',
            'platform.code as platform', 'region.code as region', 'sector.code as sector'
          )
          .orderBy('createdAt desc')
      )

      const systems = rows.map((r) => ({
        id: r.ID,
        sysId: r.systemId,
        client: r.client,
        sysType: titleCase(r.tier),
        hostName: r.hostName,
        sysDetails: r.systemCompName || '',
        organizationId: r.organization_ID || '',
        organizationCode: r.organizationCode || '',
        organizationName: r.organizationName || '',
        sector: r.sector || '',
        platform: r.platform || '',
        region: r.region || '',
        clientType: r.clientType || '',
        sysVersion: r.version || '',
        logonGroup: r.logonGroup || '',
        portNumber: r.port,
        instanceNo: r.instanceNo || '',
        status: r.status,
        endpoint: r.endpoint || '',
        lastConnectionStatus: r.lastConnectionStatus || 'UNKNOWN'
      }))

      return { success: true, message: 'OK', systems }
    } finally {
      await tx.commit()
    }
  })

  srv.on('createSystem', async (req) => {
    const fail = (message) => ({ success: false, message })
    const sysId = (req.data.sysId || '').trim()
    const client = (req.data.client || '').trim()
    const hostName = (req.data.hostName || '').trim()
    const organizationId = (req.data.organizationId || '').trim()
    if (!sysId || !client || !hostName || !organizationId) {
      return fail('System ID, Client, Host Name, and Organization are required.')
    }
    // Systems.systemId/client are varchar(3) (real SAP SID/client width) -
    // an over-length value used to reach the DB unchecked and crash with a
    // raw "value too long" Postgres error instead of a real message.
    if (sysId.length > 3) return fail('System ID (SID) must be at most 3 characters.')
    if (client.length > 3) return fail('Client must be at most 3 characters.')

    const { tenantId, databaseName } = req.user.attr

    const tenantDb = await getPool(tenantId, databaseName)
    const entities = await tenantEntities()
    const { Systems, SystemCredentials, Regions, Platforms, Sectors, Organizations } = entities

    const tx = tenantDb.tx()
    try {
      const existing = await tx.run(SELECT.one.from(Systems).where({ systemId: sysId, client }))
      if (existing) return fail(`System ${sysId} / Client ${client} already exists.`)

      const org = await tx.run(SELECT.one.from(Organizations).where({ ID: organizationId }))
      if (!org) return fail('Selected Organization not found.')

      const [platformId, regionId, sectorId] = await Promise.all([
        resolveRefId(tx, Platforms, req.data.platform),
        resolveRefId(tx, Regions, req.data.region),
        resolveRefId(tx, Sectors, req.data.sector)
      ])

      const id = cds.utils.uuid()
      await tx.run(INSERT.into(Systems).entries({
        ID: id,
        systemId: sysId,
        client,
        tier: (req.data.sysType || 'QUALITY').toUpperCase(),
        systemCompName: req.data.sysDetails || null,
        hostName,
        organization_ID: organizationId,
        platform_ID: platformId,
        region_ID: regionId,
        sector_ID: sectorId,
        version: req.data.sysVersion || null,
        logonGroup: req.data.logonGroup || null,
        port: req.data.portNumber || null,
        instanceNo: req.data.instanceNo || null,
        clientType: req.data.clientType || null,
        endpoint: (req.data.endpoint || '').trim() || null,
        status: 'ACTIVE'
      }))

      await upsertCredentials(tx, SystemCredentials, id, (req.data.credUserId || '').trim(), req.data.credPassword || '')

      // Best-effort — a notification failure shouldn't block system creation.
      notify(tenantId, databaseName, {
        title: 'SAP System Added',
        message: `System ${sysId} (Client ${client}) was added to the landscape.`,
        category: 'TASK',
        priority: 'LOW',
        targetPage: 'Configuration',
        targetRecord: sysId,
        icon: 'sap-icon://add',
        iconClass: 'xyraNotifyIconGreen'
      }).catch((err) => console.error('notify(createSystem) failed:', err))

      await logAudit(tx, entities, {
        action: 'SYSTEM_CREATE',
        module: 'System Configuration',
        objectType: 'System',
        objectId: sysId,
        objectLabel: `${sysId} (${client})`,
        description: `Added SAP System '${sysId}' (Client ${client}) to the landscape.`,
        systemId: sysId,
        performedBy: req.user.attr.email,
        performedByRole: req.user.attr.persona
      })

      return { success: true, message: 'System created.', id }
    } finally {
      await tx.commit()
    }
  })

  srv.on('updateSystem', async (req) => {
    const fail = (message) => ({ success: false, message })
    const id = (req.data.id || '').trim()
    if (!id) return fail('id is required.')
    const client = (req.data.client || '').trim()
    if (client && client.length > 3) return fail('Client must be at most 3 characters.')

    const { tenantId, databaseName } = req.user.attr

    const tenantDb = await getPool(tenantId, databaseName)
    const entities = await tenantEntities()
    const { Systems, SystemCredentials, Regions, Platforms, Sectors, Organizations } = entities

    const tx = tenantDb.tx()
    try {
      const existing = await tx.run(SELECT.one.from(Systems).where({ ID: id }))
      if (!existing) return fail('System not found.')

      const organizationId = (req.data.organizationId || '').trim()
      if (organizationId) {
        const org = await tx.run(SELECT.one.from(Organizations).where({ ID: organizationId }))
        if (!org) return fail('Selected Organization not found.')
      }

      const [platformId, regionId, sectorId] = await Promise.all([
        resolveRefId(tx, Platforms, req.data.platform),
        resolveRefId(tx, Regions, req.data.region),
        resolveRefId(tx, Sectors, req.data.sector)
      ])

      await tx.run(UPDATE(Systems).set({
        client: req.data.client || existing.client,
        tier: (req.data.sysType || existing.tier || 'QUALITY').toUpperCase(),
        systemCompName: req.data.sysDetails || null,
        hostName: req.data.hostName || existing.hostName,
        organization_ID: organizationId || existing.organization_ID,
        platform_ID: platformId,
        region_ID: regionId,
        sector_ID: sectorId,
        version: req.data.sysVersion || null,
        logonGroup: req.data.logonGroup || null,
        port: req.data.portNumber || null,
        instanceNo: req.data.instanceNo || null,
        clientType: req.data.clientType || null,
        endpoint: (req.data.endpoint || '').trim() || existing.endpoint
      }).where({ ID: id }))

      await upsertCredentials(tx, SystemCredentials, id, (req.data.credUserId || '').trim(), req.data.credPassword || '', { onlyIfProvided: true })

      await logAudit(tx, entities, {
        action: 'SYSTEM_UPDATE',
        module: 'System Configuration',
        objectType: 'System',
        objectId: existing.systemId,
        objectLabel: `${existing.systemId} (${existing.client})`,
        description: `Updated SAP System '${existing.systemId}' (Client ${existing.client}).`,
        previousValue: `Host: ${existing.hostName} | Tier: ${existing.tier}`,
        newValue: `Host: ${req.data.hostName || existing.hostName} | Tier: ${(req.data.sysType || existing.tier || 'QUALITY').toUpperCase()}`,
        systemId: existing.systemId,
        performedBy: req.user.attr.email,
        performedByRole: req.user.attr.persona
      })

      return { success: true, message: 'System updated.' }
    } finally {
      await tx.commit()
    }
  })

  srv.on('deleteSystem', async (req) => {
    const fail = (message) => ({ success: false, message })
    const id = (req.data.id || '').trim()
    if (!id) return fail('id is required.')

    const { tenantId, databaseName } = req.user.attr

    const tenantDb = await getPool(tenantId, databaseName)
    const entities = await tenantEntities()
    const { Systems } = entities

    const tx = tenantDb.tx()
    try {
      const existing = await tx.run(SELECT.one.from(Systems).where({ ID: id }))
      if (!existing) return fail('System not found.')

      await deleteSystemCascade(tx, entities, id)
      await tx.run(DELETE.from(Systems).where({ ID: id }))

      await logAudit(tx, entities, {
        action: 'SYSTEM_DELETE',
        module: 'System Configuration',
        objectType: 'System',
        objectId: existing.systemId,
        objectLabel: `${existing.systemId} (${existing.client})`,
        description: `Deleted SAP System '${existing.systemId}' (Client ${existing.client}) from the landscape.`,
        systemId: existing.systemId,
        performedBy: req.user.attr.email,
        performedByRole: req.user.attr.persona
      })

      return { success: true, message: 'System deleted.' }
    } finally {
      await tx.commit()
    }
  })

  srv.on('testSystemConnection', async (req) => {
    const fail = (message) => ({ success: false, message, statusCode: null, latencyMs: null })
    const id = (req.data.id || '').trim()
    if (!id) return fail('id is required.')

    const { tenantId, databaseName } = req.user.attr

    const result = await testConnection(tenantId, databaseName, id)
    const newStatus = result.success ? 'ONLINE' : 'OFFLINE'

    const tenantDb = await getPool(tenantId, databaseName)
    const { Systems } = await tenantEntities()
    const tx = tenantDb.tx()
    let previousStatus
    try {
      const row = await tx.run(SELECT.one.from(Systems).columns('lastConnectionStatus').where({ ID: id }))
      previousStatus = row ? row.lastConnectionStatus : null
      await tx.run(UPDATE(Systems).set({ lastConnectionStatus: newStatus }).where({ ID: id }))
    } finally {
      await tx.commit()
    }

    // Only notify on the transition into OFFLINE, not on every check for as
    // long as it stays down — that's what was spamming the bell when Auto
    // Refresh or Test All Connections re-checked an already-known-offline system.
    if (newStatus === 'OFFLINE' && previousStatus !== 'OFFLINE') {
      // Best-effort — a notification failure shouldn't affect the test result.
      notify(tenantId, databaseName, {
        title: 'SAP System Offline',
        message: result.message,
        category: 'TASK',
        priority: 'HIGH',
        targetPage: 'SystemHealth',
        icon: 'sap-icon://sys-cancel-2',
        iconClass: 'xyraNotifyIconRed'
      }).catch((err) => console.error('notify(testSystemConnection) failed:', err))
    }

    return result
  })

  srv.on('getSlaSettings', async (req) => {
    const fail = (message) => ({ success: false, message, settings: null })

    const { tenantId, databaseName } = req.user.attr

    const tenantDb = await getPool(tenantId, databaseName)
    const { SlaSettings } = await tenantEntities()
    const tx = tenantDb.tx()
    try {
      const row = await tx.run(SELECT.one.from(SlaSettings))
      const settings = row || DEFAULT_SLA_SETTINGS // legacy tenant, not yet re-provisioned/seeded
      return {
        success: true,
        message: 'OK',
        settings: Object.fromEntries(SLA_FIELDS.map((f) => [f, settings[f]]))
      }
    } finally {
      await tx.commit()
    }
  })

  srv.on('updateSlaSettings', async (req) => {
    const fail = (message) => ({ success: false, message })

    const patch = {}
    for (const f of SLA_FIELDS) {
      const n = Number(req.data[f])
      if (!Number.isInteger(n) || n < 1) return fail(`${f} must be a positive whole number of days.`)
      patch[f] = n
    }

    const { tenantId, databaseName } = req.user.attr

    const tenantDb = await getPool(tenantId, databaseName)
    const entities = await tenantEntities()
    const { SlaSettings } = entities
    const tx = tenantDb.tx()
    try {
      const existing = await tx.run(SELECT.one.from(SlaSettings))
      if (existing) {
        await tx.run(UPDATE(SlaSettings).set(patch).where({ ID: existing.ID }))
      } else {
        // Self-healing: a tenant provisioned before this feature existed.
        await tx.run(INSERT.into(SlaSettings).entries({ ID: cds.utils.uuid(), ...patch }))
      }

      await logAudit(tx, entities, {
        action: 'SLA_SETTINGS_UPDATE',
        module: 'System Configuration',
        objectType: 'SlaSettings',
        objectId: tenantId,
        objectLabel: 'Review SLA Settings',
        description: `Updated review SLA windows: Reviewer 1 ${patch.reviewer1Days}d, Reviewer 2 ${patch.reviewer2Days}d, Escalation delay ${patch.escalationDelayDays}d.`,
        performedBy: req.user.attr.email,
        performedByRole: req.user.attr.persona
      })

      return { success: true, message: 'SLA settings updated.' }
    } finally {
      await tx.commit()
    }
  })
}

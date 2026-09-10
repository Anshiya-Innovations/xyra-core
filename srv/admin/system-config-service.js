const cds = require('@sap/cds')
const { getPool, tenantEntities } = require('../../lib/tenant/TenantPoolManager')
const { resolveTenantBySubdomain } = require('../../lib/tenant/resolveTenant')
const { testConnection } = require('../../lib/connection_engine')
const { notify } = require('../../lib/notification_engine')

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
    const subdomain = (req.data.subdomain || '').trim()
    if (!subdomain) return fail('subdomain is required.')

    const resolved = await resolveTenantBySubdomain(req, subdomain)
    if (!resolved) return fail('Tenant not found.')

    const tenantDb = await getPool(resolved.tenant.ID, resolved.databaseName)
    const { Systems } = await tenantEntities()

    const tx = tenantDb.tx()
    try {
      const rows = await tx.run(
        SELECT.from(Systems)
          .columns(
            'ID', 'systemId', 'client', 'tier', 'hostName', 'systemCompName',
            'clientType', 'version', 'logonGroup', 'port', 'instanceNo', 'status', 'endpoint',
            'lastConnectionStatus', 'platform.code as platform', 'region.code as region', 'sector.code as sector'
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
    const subdomain = (req.data.subdomain || '').trim()
    const sysId = (req.data.sysId || '').trim()
    const client = (req.data.client || '').trim()
    const hostName = (req.data.hostName || '').trim()
    if (!subdomain || !sysId || !client || !hostName) return fail('System ID, Client, and Host Name are required.')

    const resolved = await resolveTenantBySubdomain(req, subdomain)
    if (!resolved) return fail('Tenant not found.')

    const tenantDb = await getPool(resolved.tenant.ID, resolved.databaseName)
    const { Systems, SystemCredentials, Regions, Platforms, Sectors } = await tenantEntities()

    const tx = tenantDb.tx()
    try {
      const existing = await tx.run(SELECT.one.from(Systems).where({ systemId: sysId, client }))
      if (existing) return fail(`System ${sysId} / Client ${client} already exists.`)

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
      notify(resolved.tenant.ID, resolved.databaseName, {
        title: 'SAP System Added',
        message: `System ${sysId} (Client ${client}) was added to the landscape.`,
        category: 'TASK',
        priority: 'LOW',
        targetPage: 'Configuration',
        targetRecord: sysId,
        icon: 'sap-icon://add',
        iconClass: 'xyraNotifyIconGreen'
      }).catch((err) => console.error('notify(createSystem) failed:', err))

      return { success: true, message: 'System created.', id }
    } finally {
      await tx.commit()
    }
  })

  srv.on('updateSystem', async (req) => {
    const fail = (message) => ({ success: false, message })
    const subdomain = (req.data.subdomain || '').trim()
    const id = (req.data.id || '').trim()
    if (!subdomain || !id) return fail('id is required.')

    const resolved = await resolveTenantBySubdomain(req, subdomain)
    if (!resolved) return fail('Tenant not found.')

    const tenantDb = await getPool(resolved.tenant.ID, resolved.databaseName)
    const { Systems, SystemCredentials, Regions, Platforms, Sectors } = await tenantEntities()

    const tx = tenantDb.tx()
    try {
      const existing = await tx.run(SELECT.one.from(Systems).where({ ID: id }))
      if (!existing) return fail('System not found.')

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

      return { success: true, message: 'System updated.' }
    } finally {
      await tx.commit()
    }
  })

  srv.on('deleteSystem', async (req) => {
    const fail = (message) => ({ success: false, message })
    const subdomain = (req.data.subdomain || '').trim()
    const id = (req.data.id || '').trim()
    if (!subdomain || !id) return fail('id is required.')

    const resolved = await resolveTenantBySubdomain(req, subdomain)
    if (!resolved) return fail('Tenant not found.')

    const tenantDb = await getPool(resolved.tenant.ID, resolved.databaseName)
    const { Systems } = await tenantEntities()

    const tx = tenantDb.tx()
    try {
      const existing = await tx.run(SELECT.one.from(Systems).where({ ID: id }))
      if (!existing) return fail('System not found.')

      await tx.run(DELETE.from(Systems).where({ ID: id }))
      return { success: true, message: 'System deleted.' }
    } finally {
      await tx.commit()
    }
  })

  srv.on('testSystemConnection', async (req) => {
    const fail = (message) => ({ success: false, message, statusCode: null, latencyMs: null })
    const subdomain = (req.data.subdomain || '').trim()
    const id = (req.data.id || '').trim()
    if (!subdomain || !id) return fail('id is required.')

    const resolved = await resolveTenantBySubdomain(req, subdomain)
    if (!resolved) return fail('Tenant not found.')

    const result = await testConnection(resolved.tenant.ID, resolved.databaseName, id)
    const newStatus = result.success ? 'ONLINE' : 'OFFLINE'

    const tenantDb = await getPool(resolved.tenant.ID, resolved.databaseName)
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
      notify(resolved.tenant.ID, resolved.databaseName, {
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
}

const net = require('net')
const cds = require('@sap/cds')
const { getPool, tenantEntities } = require('../../lib/tenant/TenantPoolManager')
const { resolveTenantBySubdomain } = require('../../lib/tenant/resolveTenant')

module.exports = function (srv) {
  srv.on('getSystemConnection', async (req) => {
    const fail = (message) => ({ success: false, message, hasConnection: false })
    const subdomain = (req.data.subdomain || '').trim()
    if (!subdomain) return fail('subdomain is required.')

    const resolved = await resolveTenantBySubdomain(req, subdomain)
    if (!resolved) return fail('Tenant not found.')

    const tenantDb = await getPool(resolved.tenant.ID, resolved.databaseName)
    const { Systems } = await tenantEntities()

    const tx = tenantDb.tx()
    try {
      // ponytail: "the first row" — this page manages one primary connection per
      // tenant for now. If multi-system monitoring (the SOP-based Rules/Alerts
      // feature) starts creating more Systems rows later, this'll need a proper
      // "which one is the primary connection" marker instead.
      const system = await tx.run(SELECT.one.from(Systems))
      if (!system) return { success: true, message: 'No connection configured yet.', hasConnection: false }

      return {
        success: true,
        message: 'OK',
        hasConnection: true,
        systemName: system.systemName,
        hostName: system.hostName,
        systemId: system.systemId,
        client: system.client,
        instanceNo: system.instanceNo,
        port: system.port,
        status: system.status
      }
    } finally {
      await tx.commit()
    }
  })

  srv.on('saveSystemConnection', async (req) => {
    const fail = (message) => ({ success: false, message })
    const subdomain = (req.data.subdomain || '').trim()
    const systemId = (req.data.systemId || '').trim()
    const client = (req.data.client || '').trim()
    if (!subdomain || !systemId || !client) return fail('System ID and Client are required.')

    const resolved = await resolveTenantBySubdomain(req, subdomain)
    if (!resolved) return fail('Tenant not found.')

    const tenantDb = await getPool(resolved.tenant.ID, resolved.databaseName)
    const { Systems, SystemCredentials } = await tenantEntities()

    const tx = tenantDb.tx()
    try {
      const existing = await tx.run(SELECT.one.from(Systems))

      const fields = {
        systemId,
        client,
        systemName: req.data.systemName || null,
        hostName: req.data.hostName || null,
        instanceNo: req.data.instanceNo || null,
        port: req.data.port || null
      }

      let systemDbId
      if (existing) {
        systemDbId = existing.ID
        await tx.run(UPDATE(Systems).set(fields).where({ ID: systemDbId }))
      } else {
        systemDbId = cds.utils.uuid()
        await tx.run(INSERT.into(Systems).entries({ ID: systemDbId, tier: 'PRODUCTION', status: 'ACTIVE', ...fields }))
      }

      if (req.data.jwtToken) {
        const creds = await tx.run(SELECT.one.from(SystemCredentials).where({ system_ID: systemDbId }))
        if (creds) {
          await tx.run(UPDATE(SystemCredentials).set({ jwtToken: req.data.jwtToken }).where({ ID: creds.ID }))
        } else {
          await tx.run(INSERT.into(SystemCredentials).entries({ ID: cds.utils.uuid(), system_ID: systemDbId, jwtToken: req.data.jwtToken }))
        }
      }

      return { success: true, message: 'Configuration saved.' }
    } finally {
      await tx.commit()
    }
  })

  srv.on('testSystemConnection', async (req) => {
    const hostName = (req.data.hostName || '').trim()
    const port = Number(req.data.port)
    if (!hostName || !port) return { success: false, message: 'Host name and port are required.' }

    return new Promise((resolve) => {
      const t0 = Date.now()
      const socket = net.createConnection({ host: hostName, port, timeout: 3000 })
      socket.on('connect', () => {
        socket.destroy()
        resolve({ success: true, message: `Reachable (${Date.now() - t0}ms). Note: this checks TCP connectivity only, not SAP authentication.` })
      })
      socket.on('timeout', () => {
        socket.destroy()
        resolve({ success: false, message: 'Connection timed out after 3s.' })
      })
      socket.on('error', (err) => {
        resolve({ success: false, message: 'Could not reach host: ' + err.message })
      })
    })
  })
}

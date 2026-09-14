const { getPool, tenantEntities } = require('../../lib/tenant/TenantPoolManager')
const { resolveTenantBySubdomain } = require('../../lib/tenant/resolveTenant')
const { logAudit } = require('../../lib/audit')

function toEntry(r) {
  return {
    id: r.ID,
    createdAt: r.createdAt,
    action: r.action,
    module: r.module,
    objectType: r.objectType || '',
    objectId: r.objectId || '',
    objectLabel: r.objectLabel || '',
    description: r.description,
    previousValue: r.previousValue || '',
    newValue: r.newValue || '',
    result: r.result || 'SUCCESS',
    systemId: r.systemId || '',
    controlId: r.controlId || '',
    performedBy: r.performedBy,
    performedByRole: r.performedByRole || ''
  }
}

module.exports = function (srv) {
  srv.on('logEvent', async (req) => {
    const fail = (message) => ({ success: false, message })
    const subdomain = (req.data.subdomain || '').trim()
    if (!subdomain) return fail('subdomain is required.')
    if (!req.data.action || !req.data.module || !req.data.description) {
      return fail('action, module and description are required.')
    }

    const resolved = await resolveTenantBySubdomain(req, subdomain)
    if (!resolved) return fail('Tenant not found.')

    const tenantDb = await getPool(resolved.tenant.ID, resolved.databaseName)
    const entities = await tenantEntities()
    const tx = tenantDb.tx()
    try {
      await logAudit(tx, entities, req.data)
      return { success: true, message: 'OK' }
    } finally {
      await tx.commit()
    }
  })

  srv.on('listAuditLogs', async (req) => {
    const fail = (message) => ({ success: false, message, logs: [] })
    const subdomain = (req.data.subdomain || '').trim()
    if (!subdomain) return fail('subdomain is required.')

    const resolved = await resolveTenantBySubdomain(req, subdomain)
    if (!resolved) return fail('Tenant not found.')

    const tenantDb = await getPool(resolved.tenant.ID, resolved.databaseName)
    const { AuditLogs } = await tenantEntities()
    const tx = tenantDb.tx()
    try {
      // ponytail: fetch-most-recent-N + filter-in-JS on the frontend, same
      // "small per-tenant dataset" convention every other list endpoint here
      // uses (deviation-service.js, review_engine). The limit is a pragmatic
      // cap, not real pagination - revisit only if row counts actually get there.
      const rows = await tx.run(SELECT.from(AuditLogs).orderBy('createdAt desc').limit(500))
      return { success: true, message: 'OK', logs: rows.map(toEntry) }
    } finally {
      await tx.commit()
    }
  })
}

const cds = require('@sap/cds')

const PLATFORM_BASE_DOMAIN = 'xyra-ccm.com'
const fullDomainFor = (subdomain) => `${subdomain}.${PLATFORM_BASE_DOMAIN}`

// Master-layer audit trail (xyra.master.AuditLogs). Best-effort: a failed log
// write must never undo or mask the platform action it describes.
async function logPlatformAudit(tenantId, action, details, performedBy) {
  try {
    const { AuditLogs } = cds.entities('xyra.master')
    await INSERT.into(AuditLogs).entries({
      ID: cds.utils.uuid(),
      tenant_ID: tenantId || null,
      action,
      entityName: 'Tenants',
      entityKey: tenantId || null,
      performedBy: performedBy || 'platform-admin',
      details: details ? String(details).slice(0, 2000) : null
    })
  } catch (err) {
    console.error(`logPlatformAudit(${action}) failed:`, err.message)
  }
}

module.exports = { PLATFORM_BASE_DOMAIN, fullDomainFor, logPlatformAudit }

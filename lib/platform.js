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

// Base URL of one tenant's own frontend, for links that leave the app (e.g.
// "Open in Xyra" in Jira tickets). Each tenant lives on its own (sub)domain,
// so this comes from its primary Domains row, never one global setting.
// DEV_APP_URL (honored only when DEV_MODE=true) points every tenant at the one
// local frontend, since *.xyra-ccm.com doesn't resolve to localhost.
async function tenantAppUrl(tenantId) {
  if (process.env.DEV_MODE === 'true' && process.env.DEV_APP_URL) return process.env.DEV_APP_URL
  const { Domains } = cds.entities('xyra.master')
  const domain = await SELECT.one.from(Domains).columns('domainName').where({ tenant_ID: tenantId, isPrimary: true })
  return domain ? `https://${domain.domainName}` : ''
}

module.exports = { PLATFORM_BASE_DOMAIN, fullDomainFor, logPlatformAudit, tenantAppUrl }

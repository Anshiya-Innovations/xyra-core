const cds = require('@sap/cds')
const { fullDomainFor } = require('../platform')

// Resolves a subdomain to its active tenant + tenant database name, one shared
// transaction across the 3 Master DB lookups — same win auth-service.js's
// profiling found (bare SELECTs each pay their own implicit-transaction round
// trip), now shared by every service that needs "which tenant is this for".
async function resolveTenantBySubdomain(req, subdomain) {
  const { Tenants, Domains, Provisioning } = cds.entities('xyra.master')
  const masterTx = cds.tx(req)

  const domain = await masterTx.run(SELECT.one.from(Domains).where({ domainName: fullDomainFor(subdomain) }))
  if (!domain) return null

  const tenant = await masterTx.run(SELECT.one.from(Tenants).where({ ID: domain.tenant_ID }))
  if (!tenant || tenant.status !== 'ACTIVE') return null

  const job = await masterTx.run(SELECT.one.from(Provisioning).where({ tenant_ID: domain.tenant_ID }))
  if (!job || !job.databaseName) return null

  return { tenant, databaseName: job.databaseName }
}

module.exports = { resolveTenantBySubdomain }

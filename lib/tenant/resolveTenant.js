const cds = require('@sap/cds')
const { fullDomainFor } = require('../platform')

// Cache of subdomain -> { tenant, databaseName, resolvedAt }. Every one of the
// 3 lookups below is a round trip to the remote Master RDS instance, paid on
// EVERY request by all 8 tenant-scoped services - measured at ~1.3-1.5s per
// request, identical across endpoints with completely different query shapes,
// confirming it's this fixed uncached cost and not the actual per-endpoint
// work. Mirrors TenantPoolManager.js's own Map-based cache (same proven
// pattern, not a new mechanism).
//
// ponytail: 60s TTL, not indefinite - this is a security-relevant status
// check (deactivating/re-provisioning a tenant should take effect quickly),
// not just a perf cache. 60s bounds staleness to a minute while still being a
// hit for nearly every real request, since a user's page-to-page navigation
// re-hits these endpoints constantly. Raise it if 60s proves too tight, add a
// push-based invalidation only if that's ever actually a problem.
const CACHE_TTL_MS = 60 * 1000
const cache = new Map() // subdomain -> { tenant, databaseName, resolvedAt }

async function lookupTenantBySubdomain(req, subdomain) {
  const { Tenants, Domains, Provisioning } = cds.entities('xyra.master')
  const masterTx = cds.tx(req)

  const domain = await masterTx.run(SELECT.one.from(Domains).where({ domainName: fullDomainFor(subdomain) }))
  if (!domain) return null

  // Tenants and Provisioning both depend only on domain.tenant_ID, not on
  // each other - run them together instead of two serial round trips.
  const [tenant, job] = await Promise.all([
    masterTx.run(SELECT.one.from(Tenants).where({ ID: domain.tenant_ID })),
    masterTx.run(SELECT.one.from(Provisioning).where({ tenant_ID: domain.tenant_ID }))
  ])
  if (!tenant || tenant.status !== 'ACTIVE') return null
  if (!job || !job.databaseName) return null

  return { tenant, databaseName: job.databaseName }
}

// Resolves a subdomain to its active tenant + tenant database name. Cached
// per subdomain (see CACHE_TTL_MS) - a miss falls back to the real 2-round-trip
// lookup above. A failed lookup (unknown/inactive domain) is never cached, so
// a typo'd subdomain doesn't get stuck negative-cached against a tenant that
// gets provisioned moments later.
async function resolveTenantBySubdomain(req, subdomain) {
  const cached = cache.get(subdomain)
  if (cached && Date.now() - cached.resolvedAt < CACHE_TTL_MS) {
    return { tenant: cached.tenant, databaseName: cached.databaseName }
  }

  const resolved = await lookupTenantBySubdomain(req, subdomain)
  if (!resolved) {
    cache.delete(subdomain)
    return null
  }

  cache.set(subdomain, { ...resolved, resolvedAt: Date.now() })
  return resolved
}

module.exports = { resolveTenantBySubdomain }

const cds = require('@sap/cds')

// LOGIN-TIME ONLY. Maps the hostname a user signed in on (acme.xyra-ccm.com,
// or a custom domain) to its tenant. After login the tenant comes from the
// session token (lib/auth/middleware.js) and this is never consulted again —
// the domain is an entry point into a tenant, not a credential.
//
// ponytail: 60s process-local TTL, failed lookups never cached (so a tenant
// provisioned moments ago isn't stuck negative). Status is re-checked against
// TenantDirectory by the caller, so a suspension still bites immediately.
const CACHE_TTL_MS = 60 * 1000
const cache = new Map() // hostname -> { tenantId, resolvedAt }

async function lookup(hostname) {
  const { Domains } = cds.entities('xyra.master')
  const domain = await SELECT.one.from(Domains).columns('tenant_ID').where({ domainName: hostname })
  return domain ? domain.tenant_ID : null
}

async function resolveTenantIdByHost(hostname) {
  const host = String(hostname || '').toLowerCase()
  const cached = cache.get(host)
  if (cached && Date.now() - cached.resolvedAt < CACHE_TTL_MS) return cached.tenantId

  const tenantId = await lookup(host)
  if (!tenantId) {
    cache.delete(host)
    return null
  }
  cache.set(host, { tenantId, resolvedAt: Date.now() })
  return tenantId
}

// X-Forwarded-Host first (behind the reverse proxy), port stripped.
function requestHostname(httpReq) {
  const raw = httpReq.headers['x-forwarded-host'] || httpReq.headers.host || ''
  return String(raw).split(',')[0].trim().replace(/:\d+$/, '').toLowerCase()
}

const clearTenantCache = () => cache.clear()

module.exports = { resolveTenantIdByHost, requestHostname, clearTenantCache }

const { getPool, tenantEntities } = require('../tenant/TenantPoolManager')

// connection_engine: establishes and verifies connections to a tenant's SAP
// S/4HANA systems, using the endpoint + credentials already on file in
// Systems/SystemCredentials (see db/tenant/sap.cds). This is a library
// module only — nothing here is wired into a CAP service/action yet.
//
// First feature: testConnection() — reach the system's own API with whatever
// credential is on file and report back. This supersedes the plain TCP-only
// check in srv/admin/system-config-service.js's testSystemConnection action
// (that one explicitly says "not real SAP protocol/auth validation... needs
// actual RFC/HTTP integration, a separate ticket" — this module is that).

const DEFAULT_TIMEOUT_MS = 8000

// ponytail: SystemCredentials.passwordHash is a HASH (see sap.cds's own
// comment on the entity) — fine for verifying a login attempt against XYRA's
// own database, but Basic Auth against a real SAP system needs the actual
// plain password, which a hash can never produce. jwtToken is the only
// credential here that's genuinely usable as stored. Basic Auth is wired up
// below anyway so the shape/extension point is visible, but it won't
// authenticate against a real system until userId/password stops being
// stored as a one-way hash (e.g. move to a real secrets store that can hand
// back the plain value, or drop passwordHash in favor of jwtToken only).
function buildAuthHeader(credentials) {
  if (credentials && credentials.jwtToken) {
    return { Authorization: `Bearer ${credentials.jwtToken}` }
  }
  if (credentials && credentials.userId && credentials.passwordHash) {
    const basic = Buffer.from(`${credentials.userId}:${credentials.passwordHash}`).toString('base64')
    return { Authorization: `Basic ${basic}` }
  }
  return {}
}

// Systems.endpoint is the full URL when set (preferred — some systems front
// their API behind a path/gateway that hostName+port alone can't express);
// falls back to composing one from hostName+port for systems configured the
// simpler way (matches what Configuration's Add/Edit System dialog collects).
function buildBaseUrl(system) {
  if (system.endpoint) return system.endpoint.replace(/\/$/, '')
  if (!system.hostName) return null
  const port = system.port || 443
  return `https://${system.hostName}:${port}`
}

async function loadSystemAndCredentials(tenantDb, systemId, client) {
  const { Systems, SystemCredentials } = await tenantEntities()
  const tx = tenantDb.tx()
  try {
    const system = await tx.run(SELECT.one.from(Systems).where({ systemId, client }))
    if (!system) return { system: null, credentials: null }
    const credentials = await tx.run(SELECT.one.from(SystemCredentials).where({ system_ID: system.ID }))
    return { system, credentials }
  } finally {
    await tx.commit()
  }
}

// Reaches the system's own base URL/endpoint with whatever auth is on file.
// Doesn't throw — a failed/unreachable system is a normal, expected outcome
// for a monitoring tool to report, not an exceptional one.
//
// ponytail: many real SAP landscapes (especially dev/internal ones) run on
// self-signed certs, which Node's fetch will reject by default (TLS
// verification). Deliberately NOT disabling certificate validation here —
// that's a security-relevant call that shouldn't be made silently inside a
// library function. If a real system needs it, that has to be an explicit,
// visible opt-in when this gets wired up, not a default.
async function testConnection(tenantId, databaseName, systemId, client) {
  const tenantDb = await getPool(tenantId, databaseName)
  const { system, credentials } = await loadSystemAndCredentials(tenantDb, systemId, client)

  if (!system) {
    return { success: false, message: `No system ${systemId}/${client} on file.` }
  }

  const baseUrl = buildBaseUrl(system)
  if (!baseUrl) {
    return { success: false, message: 'System has no host name or endpoint configured.' }
  }

  const headers = buildAuthHeader(credentials)
  const t0 = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)

  try {
    const response = await fetch(baseUrl, { method: 'GET', headers, signal: controller.signal })
    return {
      success: response.status < 500, // a 401/403 still means "reached the system" — auth failure is a separate concern from reachability
      message: `Reached ${baseUrl} — HTTP ${response.status}`,
      statusCode: response.status,
      latencyMs: Date.now() - t0
    }
  } catch (err) {
    return {
      success: false,
      message: `Could not reach ${baseUrl}: ${err.message}`,
      latencyMs: Date.now() - t0
    }
  } finally {
    clearTimeout(timer)
  }
}

module.exports = { testConnection, buildBaseUrl, buildAuthHeader }

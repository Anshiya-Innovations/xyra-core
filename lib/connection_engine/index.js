const { getPool, tenantEntities } = require('../tenant/TenantPoolManager')

// connection_engine: establishes and verifies connections to a tenant's SAP
// S/4HANA systems, using the endpoint + credentials already on file in
// Systems/SystemCredentials (see db/tenant/sap.cds).
//
// First feature: testConnection() — reach the system using two genuinely
// standard SAP endpoints (see below) with whatever credential is on file
// (Basic userId/passwordHash, or Bearer jwtToken) and report back. Wired into
// SystemConfigService's testSystemConnection action
// (srv/admin/system-config-service.js); tested end-to-end against xyra-s4,
// the local fake SAP system built for this - see
// docs/Z-ODATA-INTEGRATION-SPEC.md for the full real-vs-fake contract.

const DEFAULT_TIMEOUT_MS = 8000

// SystemCredentials.passwordHash is misleadingly named but — per its own
// entity comment in sap.cds — is a plain stored credential (a pre-vault
// stopgap, unlike Users.passwordHash which really is a scrypt hash), so it's
// usable as-is for Basic Auth. jwtToken still wins when present (Bearer auth,
// for the Configuration page's other connection path).
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

async function loadSystemAndCredentials(tenantDb, id) {
  const { Systems, SystemCredentials } = await tenantEntities()
  const tx = tenantDb.tx()
  try {
    const system = await tx.run(SELECT.one.from(Systems).where({ ID: id }))
    if (!system) return { system: null, credentials: null }
    const credentials = await tx.run(SELECT.one.from(SystemCredentials).where({ system_ID: system.ID }))
    return { system, credentials }
  } finally {
    await tx.commit()
  }
}

// Best-effort, non-authoritative reachability probe against the real, standard,
// unauthenticated SAP ICM ping service (/sap/public/ping — present on any real
// NetWeaver/S4 system, no custom development needed). Never throws. A false
// here only sharpens testConnection's error message below - it never fails the
// connection test by itself, since some systems disable this endpoint without
// the real Gateway service being unreachable.
async function isHostReachable(baseUrl) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.floor(DEFAULT_TIMEOUT_MS / 2))
  try {
    const response = await fetch(`${baseUrl}/sap/public/ping`, { method: 'GET', signal: controller.signal })
    return response.status < 500
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

// Reaches the system with whatever auth is on file and checks it's actually
// accepted, not just that the host is up - against two genuinely standard SAP
// endpoints that need zero custom ABAP development on the target system:
//   1. /sap/public/ping - unauthenticated ICM reachability (diagnostic only,
//      see isHostReachable).
//   2. /sap/opu/odata/iwfnd/catalogservice;v=2/ServiceCollection - the real
//      SAP Gateway service catalog. Requires Gateway to be active (true of
//      any Fiori/OData-using S/4 system) but no custom service - and it
//      genuinely 401s on bad Basic Auth, which is exactly what proves the
//      credentials on file are correct. Only the HTTP status is used; the
//      catalog's own body (a list of every registered OData service) is
//      irrelevant here.
// Doesn't throw — a failed/unreachable system is a normal, expected outcome
// for a monitoring tool to report, not an exceptional one.
//
// ponytail: many real SAP landscapes (especially dev/internal ones) run on
// self-signed certs, which Node's fetch will reject by default (TLS
// verification). Deliberately NOT disabling certificate validation here —
// that's a security-relevant call that shouldn't be made silently inside a
// library function. If a real system needs it, that has to be an explicit,
// visible opt-in when this gets wired up, not a default.
async function testConnection(tenantId, databaseName, id) {
  const tenantDb = await getPool(tenantId, databaseName)
  const { system, credentials } = await loadSystemAndCredentials(tenantDb, id)

  if (!system) {
    return { success: false, message: `No system on file for id ${id}.` }
  }

  const baseUrl = buildBaseUrl(system)
  if (!baseUrl) {
    return { success: false, message: 'System has no host name or endpoint configured.' }
  }

  const hostReachable = await isHostReachable(baseUrl)

  const catalogUrl = `${baseUrl}/sap/opu/odata/iwfnd/catalogservice;v=2/ServiceCollection` +
    `?sap-client=${encodeURIComponent(system.client || '')}&$format=json`
  const headers = buildAuthHeader(credentials)
  const t0 = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)

  try {
    const response = await fetch(catalogUrl, { method: 'GET', headers, signal: controller.signal })
    if (response.status === 401) {
      return { success: false, message: `Reached ${baseUrl} but authentication was rejected (HTTP 401) when querying the Gateway service catalog. Check userId/password.`, statusCode: 401, latencyMs: Date.now() - t0 }
    }
    return {
      success: response.status < 400,
      message: `Reached ${baseUrl} — HTTP ${response.status} from the Gateway service catalog.`,
      statusCode: response.status,
      latencyMs: Date.now() - t0
    }
  } catch (err) {
    const hint = hostReachable === false ? ' (host also failed a basic /sap/public/ping reachability check)' : ''
    return {
      success: false,
      message: `Could not reach ${baseUrl}: ${err.message}${hint}`,
      latencyMs: Date.now() - t0
    }
  } finally {
    clearTimeout(timer)
  }
}

module.exports = { testConnection, buildBaseUrl, buildAuthHeader }

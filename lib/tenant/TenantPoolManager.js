const path = require('path')
const cds = require('@sap/cds')
const { adminCredentials } = require('../provisioning/database')
const perf = require('../perf/trace')

const TENANT_MODEL_PATH = path.join(__dirname, '..', '..', 'db', 'tenant', 'schema.cds')

// Loaded once per process, compiled the same way cds's own bootstrap compiles the
// main app model (cds.compile.for.nodejs) — a plain minified CSN silently gets
// ignored for result-column mapping once the app's own ambient cds.model is set
// (confirmed by testing: rows come back as raw lowercase Postgres column names
// instead of the CSN's camelCase field names, e.g. `passwordhash` not `passwordHash`).
let _tenantCsn
async function loadTenantModel() {
  if (!_tenantCsn) _tenantCsn = await cds.load(TENANT_MODEL_PATH).then(cds.minify).then(cds.compile.for.nodejs)
  return _tenantCsn
}

async function tenantEntities() {
  const csn = await loadTenantModel()
  return cds.linked(csn).entities('xyra.tenant')
}

// --- Pooling ---------------------------------------------------------------
//
// This is the ONLY place that should ever call cds.connect.to() for a tenant
// database. Every service (auth, provisioning, and whatever rules/alerts/
// dashboard code comes later) goes through getPool(tenantId, databaseName)
// instead of knowing how to open a tenant connection itself.
//
// Why this exists, not just "call cds.connect.to() directly like before":
// cds.connect.to(name, options) only checks/populates its own cds.services
// cache when `options` is falsy (see node_modules/@sap/cds/lib/srv/cds-connect.js
// lines 29 and 44) — and every tenant connection here needs explicit options
// (credentials, pool config), so that cache never engages. Confirmed by testing:
// two consecutive calls with identical credentials each paid the full cold-connect
// cost (~3.2s to this RDS instance) — there was no reuse at all happening before
// this module existed, despite it looking cached from the outside (the *call*
// resolves fast even when the underlying connection isn't warm, which is what
// made this easy to miss the first time around).

const MAX_POOLS = 50
const IDLE_TIMEOUT_MS = 30 * 60 * 1000 // close a tenant pool unused for 30 min
const MAX_LIFETIME_MS = 6 * 60 * 60 * 1000 // recycle a pool after 6h regardless of use

const pools = new Map() // tenantId -> { db, databaseName, createdAt, lastUsedAt }
const connecting = new Map() // tenantId -> { databaseName, promise } while a connect is in flight
// Warm request = hit (no connect). Watch creates/connectMs before tuning
// MAX_POOLS, or before deciding PgBouncer is worth adding.
const stats = { hits: 0, misses: 0, creates: 0, evictions: 0, lastConnectMs: 0, maxConnectMs: 0, totalConnectMs: 0 }

async function connect(databaseName) {
  const credentials = { ...adminCredentials(), database: databaseName }
  const db = await cds.connect.to(`tenant-db-${databaseName}`, {
    kind: 'postgres',
    credentials,
    pool: { acquireTimeoutMillis: 10000 }
  })
  db.model = await loadTenantModel()
  return db
}

function getPool(tenantId, databaseName) {
  return perf.timed('poolLookup', () => lookupPool(tenantId, databaseName))
}

async function lookupPool(tenantId, databaseName) {
  const now = Date.now()
  const cached = pools.get(tenantId)

  if (cached && cached.databaseName === databaseName) {
    // Move to the end of Map's iteration order = "most recently used", for the
    // cheap LRU eviction below (oldest entry = first key in iteration order).
    pools.delete(tenantId)
    cached.lastUsedAt = now
    pools.set(tenantId, cached)
    stats.hits++
    perf.note('poolHit', true)
    return cached.db
  }

  // Concurrent cold requests for one tenant share a single connect instead of
  // each opening (and then leaking) their own pool.
  const pending = connecting.get(tenantId)
  if (pending && pending.databaseName === databaseName) return pending.promise

  const promise = createPool(tenantId, databaseName, cached).finally(() => connecting.delete(tenantId))
  connecting.set(tenantId, { databaseName, promise })
  return promise
}

async function createPool(tenantId, databaseName, stale) {
  if (stale) {
    // Tenant was pointed at a different physical database than last time
    // (e.g. migrated to a new cluster) — don't keep serving the stale pool.
    await evict(tenantId)
  }

  stats.misses++
  perf.note('poolHit', false)
  const started = Date.now()
  const db = await connect(databaseName)
  const ms = Date.now() - started
  stats.creates++
  stats.lastConnectMs = ms
  stats.totalConnectMs += ms
  stats.maxConnectMs = Math.max(stats.maxConnectMs, ms)

  if (pools.size >= MAX_POOLS) {
    const oldestKey = pools.keys().next().value
    await evict(oldestKey)
  }

  const now = Date.now()
  pools.set(tenantId, { db, databaseName, createdAt: now, lastUsedAt: now })
  return db
}

async function evict(tenantId) {
  const entry = pools.get(tenantId)
  if (!entry) return
  pools.delete(tenantId)
  stats.evictions++
  try {
    await entry.db.disconnect()
  } catch {
    // best-effort — a pool that's already broken doesn't need to fail eviction
  }
}

async function sweep() {
  const now = Date.now()
  for (const [tenantId, entry] of pools) {
    if (now - entry.lastUsedAt > IDLE_TIMEOUT_MS || now - entry.createdAt > MAX_LIFETIME_MS) {
      await evict(tenantId)
    }
  }
}

// ponytail: a simple periodic sweep, not a per-entry timer — good enough at the
// pool counts this is meant for (tens, not thousands); revisit if MAX_POOLS ever
// needs to grow far past its current default.
const sweepInterval = setInterval(sweep, 5 * 60 * 1000)
sweepInterval.unref() // don't keep a process alive (e.g. scripts, tests) just for this

function getStats() {
  const avgConnectMs = stats.creates ? Math.round(stats.totalConnectMs / stats.creates) : 0
  return { openPools: pools.size, maxPools: MAX_POOLS, tenantIds: [...pools.keys()], avgConnectMs, ...stats }
}

module.exports = { getPool, evict, getStats, tenantEntities, loadTenantModel, TENANT_MODEL_PATH }

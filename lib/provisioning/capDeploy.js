const path = require('path')
const cds = require('@sap/cds')
const { adminCredentials } = require('./database')

const TENANT_MODEL_PATH = path.join(__dirname, '..', '..', 'db', 'tenant', 'schema.cds')

// Loaded once per process and compiled the same way cds's own bootstrap compiles
// the main app model (cds.compile.for.nodejs). This matters: once the server's
// ambient cds.model is set (which it always is, once serving requests), a plain
// minified CSN assigned to a *different* service's `.model` gets silently ignored
// for result-column mapping — rows come back with raw lowercase Postgres column
// names (e.g. `passwordhash`) instead of the CSN's camelCase field names
// (`passwordHash`), breaking any code reading those fields. Confirmed by testing:
// this only reproduces once the ambient cds.model is set, which is exactly what
// happens in the real running server — a standalone script without that ambient
// state masked the bug.
let _tenantCsn
async function loadTenantModel() {
  if (!_tenantCsn) _tenantCsn = await cds.load(TENANT_MODEL_PATH).then(cds.minify).then(cds.compile.for.nodejs)
  return _tenantCsn
}

// IMPORTANT: cds.connect.to('db', ...) is NOT safe here — this project's package.json
// already registers a 'db' service (the Master DB), so re-using that name silently
// ignores whatever credentials you pass and reconnects to the Master DB instead.
// Confirmed by testing: each tenant connection needs its own unique service name,
// and the pool.acquireTimeoutMillis override (RDS is slower than the 1s default)
// has to be passed explicitly too — it isn't inherited from package.json for ad-hoc
// connections the way it is for the primary 'db' service.
//
// Also important: cds.connect.to() defaults a new service's `.model` to the
// ambient global cds.model (the main app/Master DB model) — not "no model", so
// an `if (!db.model)` guard here never fires. Confirmed by testing: without an
// unconditional override, query results silently come back mapped against the
// wrong (Master) model, which for a same-named-but-absent field just means raw
// lowercase Postgres column names leak through (e.g. `passwordhash` instead of
// `passwordHash`) instead of an error — a hard bug to notice.
async function connectToTenantDb(dbName) {
  const credentials = { ...adminCredentials(), database: dbName }
  const db = await cds.connect.to(`tenant-db-${dbName}`, {
    kind: 'postgres',
    credentials,
    pool: { acquireTimeoutMillis: 10000 }
  })
  db.model = await loadTenantModel()
  return db
}

// Deploys the Tenant Layer model (Users, Roles, SAPConnections, Rules, Alerts, ...)
// into the tenant's own database — never the Master DB. Naturally idempotent:
// cds deploy (re)creates the tenant-layer tables from scratch each run, which is
// fine here because this always runs before seeding/admin-creation in the pipeline.
async function deployTenantSchema(dbName) {
  const db = await connectToTenantDb(dbName)
  await cds.deploy(TENANT_MODEL_PATH).to(db)
  return db
}

// Reflected entity definitions for the tenant model, used by seed.js/auth-service.js
// to build queries without hardcoding table/column names.
async function tenantEntities() {
  const csn = await loadTenantModel()
  return cds.linked(csn).entities('xyra.tenant')
}

module.exports = { deployTenantSchema, connectToTenantDb, tenantEntities, TENANT_MODEL_PATH }

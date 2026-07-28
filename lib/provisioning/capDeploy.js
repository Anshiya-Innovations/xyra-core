const cds = require('@sap/cds')
const { getPool, TENANT_MODEL_PATH } = require('../tenant/TenantPoolManager')

// Deploys the Tenant Layer model (Users, Roles, SAPConnections, Rules, Alerts, ...)
// into the tenant's own database — never the Master DB. Naturally idempotent:
// cds deploy (re)creates the tenant-layer tables from scratch each run, which is
// fine here because this always runs before seeding/admin-creation in the pipeline.
//
// Goes through TenantPoolManager like everything else that needs a tenant
// connection — provisioning doesn't get to know how tenant pooling works either.
async function deployTenantSchema(tenantId, databaseName) {
  const db = await getPool(tenantId, databaseName)
  await cds.deploy(TENANT_MODEL_PATH).to(db)
  return db
}

module.exports = { deployTenantSchema, TENANT_MODEL_PATH }

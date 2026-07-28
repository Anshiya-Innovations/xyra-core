const cds = require('@sap/cds')

// Step 8: write the outcome of a successful provisioning run back to the Master DB.
// The Provisioning/job row itself (status, currentStep, databaseName/Host/Port,
// completedAt) is updated by the orchestrator, since it owns that bookkeeping across
// every step — this just flips the tenant and its primary domain to their final state.
async function markTenantActive(tenantId) {
  const { Tenants, Domains } = cds.entities('xyra.master')

  await UPDATE(Tenants).set({ status: 'ACTIVE' }).where({ ID: tenantId })
  await UPDATE(Domains).set({ verified: true }).where({ tenant_ID: tenantId, isPrimary: true })
}

module.exports = { markTenantActive }

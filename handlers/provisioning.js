const cds = require('@sap/cds')
const { createTenantDatabase, tenantDatabaseName } = require('../lib/provisioning/database')
const { deployTenantSchema } = require('../lib/provisioning/capDeploy')
const { seedInitialData, createAdminUser } = require('../lib/provisioning/seed')
const { dnsService } = require('../lib/provisioning/dns')
const { markTenantActive } = require('../lib/provisioning/masterUpdate')

// ponytail: no real app infrastructure target exists yet — this is just what the
// DNS record would point at once one does. Swap for the real LB/ingress hostname.
const DNS_TARGET = 'app.xyra-ccm.com'

function subdomainFromDomain(domainName) {
  return domainName.split('.')[0]
}

async function updateJob(jobId, fields) {
  const { Provisioning } = cds.entities('xyra.master')
  await UPDATE(Provisioning).set(fields).where({ ID: jobId })
}

// Runs (or re-runs) the full provisioning pipeline for one tenant. Used by both
// "start" and "retry" — per-step idempotency (see lib/provisioning/*) means a
// retry is just "run the whole thing again", not a resume-from-checkpoint system.
async function runProvisioning(tenantId) {
  const { Tenants, Domains, Provisioning } = cds.entities('xyra.master')

  const tenant = await SELECT.one.from(Tenants).where({ ID: tenantId })
  if (!tenant) return { success: false, message: 'Tenant not found.' }

  if (tenant.status === 'ACTIVE') {
    return { success: true, tenantId, status: 'ACTIVE', message: 'Tenant is already active.' }
  }
  if (tenant.status !== 'PROVISIONING') {
    return { success: false, message: `Tenant is not in PROVISIONING state (current status: ${tenant.status}).` }
  }

  let job = await SELECT.one.from(Provisioning).where({ tenant_ID: tenantId })
  if (!job) {
    const jobId = cds.utils.uuid()
    await INSERT.into(Provisioning).entries({ ID: jobId, tenant_ID: tenantId, status: 'PENDING' })
    job = { ID: jobId }
  }
  // ponytail: check-then-set, not a real lock — a genuinely concurrent second
  // request could still slip through between this check and the RUNNING write
  // below. Fine for now; upgrade to a DB advisory lock if concurrent retries
  // from a real admin UI turn out to be common.
  if (job.status === 'RUNNING') {
    return { success: false, message: 'Provisioning is already in progress for this tenant.' }
  }

  const domain = await SELECT.one.from(Domains).where({ tenant_ID: tenantId, isPrimary: true })
  if (!domain) return { success: false, message: 'Tenant has no primary domain on record.' }
  const subdomain = subdomainFromDomain(domain.domainName)

  await updateJob(job.ID, { status: 'RUNNING', startedAt: new Date().toISOString(), errorMessage: null })

  let step = 'CREATE_DATABASE'
  let temporaryPassword = null
  try {
    const dbName = tenantDatabaseName(subdomain)
    await createTenantDatabase(dbName)
    await updateJob(job.ID, { currentStep: step })

    step = 'DEPLOY_SCHEMA'
    const tenantDb = await deployTenantSchema(tenantId, dbName)
    await updateJob(job.ID, { currentStep: step })

    step = 'SEED_DATA'
    await seedInitialData(tenantDb)
    await updateJob(job.ID, { currentStep: step })

    step = 'CREATE_ADMIN'
    const adminResult = await createAdminUser(tenantDb, { name: tenant.adminName, email: tenant.adminEmail })
    temporaryPassword = adminResult.temporaryPassword
    await updateJob(job.ID, { currentStep: step })

    step = 'CREATE_DNS'
    await dnsService.createRecord(subdomain, DNS_TARGET)
    await updateJob(job.ID, { currentStep: step })

    step = 'UPDATE_MASTER'
    const cr = cds.env.requires.db.credentials
    await markTenantActive(tenantId)
    await updateJob(job.ID, {
      status: 'COMPLETED',
      currentStep: 'COMPLETED',
      databaseName: dbName,
      databaseHost: cr.host,
      databasePort: cr.port,
      completedAt: new Date().toISOString()
    })
  } catch (err) {
    await updateJob(job.ID, { status: 'FAILED', currentStep: step, errorMessage: String(err.message || err) })
    return { success: false, message: `Provisioning failed at step ${step}: ${err.message}` }
  }

  // temporaryPassword is shown once, here, and never again — it's already hashed in the DB.
  return {
    success: true,
    tenantId,
    status: 'ACTIVE',
    message: 'Tenant provisioned successfully.',
    adminEmail: tenant.adminEmail,
    adminTemporaryPassword: temporaryPassword
  }
}

async function getProvisioningStatus(tenantId) {
  const { Tenants, Provisioning } = cds.entities('xyra.master')

  const tenant = await SELECT.one.from(Tenants).where({ ID: tenantId })
  if (!tenant) return { success: false, message: 'Tenant not found.' }

  const job = await SELECT.one.from(Provisioning).where({ tenant_ID: tenantId })
  return {
    success: true,
    tenantId,
    tenantStatus: tenant.status,
    jobStatus: job ? job.status : null,
    currentStep: job ? job.currentStep : null,
    startedAt: job ? job.startedAt : null,
    completedAt: job ? job.completedAt : null,
    errorMessage: job ? job.errorMessage : null
  }
}

module.exports = { runProvisioning, getProvisioningStatus }

const cds = require('@sap/cds')
const { logPlatformAudit } = require('../../lib/platform')
const { clearTenantCache } = require('../../lib/tenant/resolveTenant')

const byTenant = (rows) => new Map(rows.map((r) => [r.tenant_ID, r]))

module.exports = function (srv) {
  const { Tenants, Domains, Subscriptions, SubscriptionPlans, Provisioning, AuditLogs } = cds.entities('xyra.master')

  // ponytail: 4 whole-table reads joined in JS — fine for tens/hundreds of
  // tenants. Swap for one SQL join + paging if the registry gets big.
  srv.on('listTenants', async () => {
    const [tenants, domains, subs, plans, jobs] = await Promise.all([
      SELECT.from(Tenants).orderBy('createdAt desc'),
      SELECT.from(Domains).where({ isPrimary: true }),
      SELECT.from(Subscriptions),
      SELECT.from(SubscriptionPlans),
      SELECT.from(Provisioning)
    ])
    const domainOf = byTenant(domains)
    const subOf = byTenant(subs)
    const jobOf = byTenant(jobs)
    const planById = new Map(plans.map((p) => [p.ID, p]))

    return {
      success: true,
      message: '',
      tenants: tenants.map((t) => {
        const sub = subOf.get(t.ID)
        const plan = sub && planById.get(sub.plan_ID)
        const job = jobOf.get(t.ID)
        return {
          id: t.ID,
          companyName: t.companyName,
          status: t.status,
          adminName: t.adminName,
          adminEmail: t.adminEmail,
          domain: domainOf.get(t.ID)?.domainName || null,
          planCode: plan?.code || null,
          planName: plan?.name || null,
          subscriptionStatus: sub?.status || null,
          jobStatus: job?.status || null,
          currentStep: job?.currentStep || null,
          errorMessage: job?.errorMessage || null,
          databaseName: job?.databaseName || null,
          createdAt: t.createdAt,
          completedAt: job?.completedAt || null
        }
      })
    }
  })

  srv.on('setTenantStatus', async (req) => {
    const { tenantId, status } = req.data
    if (!['ACTIVE', 'SUSPENDED'].includes(status)) return { success: false, message: 'Status must be ACTIVE or SUSPENDED.' }

    const tenant = await SELECT.one.from(Tenants).where({ ID: tenantId })
    if (!tenant) return { success: false, message: 'Tenant not found.' }
    const from = status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE'
    if (tenant.status !== from) {
      return { success: false, message: `Only ${from} tenants can be set to ${status} (current: ${tenant.status}).` }
    }

    await UPDATE(Tenants).set({ status }).where({ ID: tenantId })
    // Resolver caches ACTIVE lookups for 60s — drop it so a suspension bites now.
    clearTenantCache()
    await logPlatformAudit(tenantId, status === 'ACTIVE' ? 'TENANT_REACTIVATED' : 'TENANT_SUSPENDED', tenant.companyName, req.headers['x-platform-admin'])
    return { success: true, message: `${tenant.companyName} is now ${status}.` }
  })

  srv.on('listPlans', async () => {
    const plans = await SELECT.from(SubscriptionPlans).orderBy('price')
    return {
      success: true,
      message: '',
      plans: plans.map((p) => ({ id: p.ID, code: p.code, name: p.name, billingCycle: p.billingCycle, price: p.price, maxUsers: p.maxUsers }))
    }
  })

  srv.on('listAuditLogs', async () => {
    const [logs, tenants] = await Promise.all([
      SELECT.from(AuditLogs).orderBy('performedAt desc').limit(500),
      SELECT.from(Tenants).columns('ID', 'companyName')
    ])
    const nameOf = new Map(tenants.map((t) => [t.ID, t.companyName]))
    return {
      success: true,
      message: '',
      logs: logs.map((l) => ({
        id: l.ID,
        tenantId: l.tenant_ID,
        companyName: nameOf.get(l.tenant_ID) || null,
        action: l.action,
        performedBy: l.performedBy,
        performedAt: l.performedAt,
        details: l.details
      }))
    }
  })
}
